import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private systemLogsService: SystemLogsService,
  ) { }

  // 获取最近的系统运行日志
  getSystemLogs(limit: number = 50) {
    return this.systemLogsService.getRecent(limit);
  }

  // 核心指标统计 (新版：关注行动与质量转化)
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. 今日采集素材量 & 成功率
    const [todayMaterials, todayFailedMaterials] = await Promise.all([
      this.prisma.material.count({ where: { collectDate: { gte: today } } }),
      this.prisma.material.count({ where: { collectDate: { gte: today }, status: 'failed' } }),
    ]);
    const successRate = todayMaterials > 0 ? ((todayMaterials - todayFailedMaterials) / todayMaterials * 100).toFixed(1) : '0.0';

    // 2. 待发布草稿
    const pendingDraftArticles = await this.prisma.article.count({
      where: {
        status: 'draft',
      },
    });

    // 3. 今日成片量 / 累计总数
    const [todayArticles, totalArticles] = await Promise.all([
      this.prisma.article.count({ where: { createdAt: { gte: today } } }),
      this.prisma.article.count(),
    ]);

    // 4. 获取今日最高光关键词 (今日生成的选题中分数最高的关键词之一)
    let topKeyword = '暂无数据';
    const recentHighTopics = await this.prisma.topic.findMany({
      where: { createdAt: { gte: today }, aiScore: { gt: 80 } },
      select: { keywords: true },
      take: 20
    });

    if (recentHighTopics.length > 0) {
      const keywordCounts: Record<string, number> = {};
      recentHighTopics.forEach(t => {
        asStringArray(t.keywords).forEach(k => {
          keywordCounts[k] = (keywordCounts[k] || 0) + 1;
        });
      });
      const sorted = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) {
        topKeyword = sorted[0][0];
      }
    }

    return {
      collection: {
        todayCount: todayMaterials,
        successRate: `${successRate}%`,
      },
      pendingDraftArticles,
      topKeyword: topKeyword,
      articles: {
        todayCount: todayArticles,
        totalCount: totalArticles,
      },
    };
  }

  // 获取关键词矩阵分析数据 (高分风向词 vs 抓取热词)
  async getKeywordMatrix() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 1. 高分风向词 (近7天 aiScore > 80)
    const highTopics = await this.prisma.topic.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, aiScore: { gt: 80 } },
      select: { keywords: true }
    });

    const highWordsCount: Record<string, number> = {};
    highTopics.forEach(t => {
      asStringArray(t.keywords).forEach(k => {
        if (k.trim().length > 1) { // 过滤掉单字
          highWordsCount[k] = (highWordsCount[k] || 0) + 1;
        }
      });
    });

    // 2. 抓取素材热榜 (近3天)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const materials = await this.prisma.material.findMany({
      where: { collectDate: { gte: threeDaysAgo } },
      select: { keywords: true }
    });

    const materialWordsCount: Record<string, number> = {};
    materials.forEach(m => {
      asStringArray(m.keywords).forEach(k => {
        if (k.trim().length > 1) {
          materialWordsCount[k] = (materialWordsCount[k] || 0) + 1;
        }
      });
    });

    // 格式化输出，适应词云或条形图
    const formatWords = (dict: Record<string, number>, limit: number = 20) => {
      return Object.entries(dict)
        .map(([text, value]) => ({ text, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
    };

    return {
      highValueKeywords: formatWords(highWordsCount, 30),
      trendingMaterialKeywords: formatWords(materialWordsCount, 30)
    };
  }

  // 获取最新待发布草稿
  async getLatestDraftArticles(limit: number = 5) {
    return this.prisma.article.findMany({
      where: { status: 'draft' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        createdAt: true,
        contentFormat: true,
        topic: {
          select: {
            title: true,
            keywords: true,
          },
        },
        template: {
          select: {
            name: true,
          },
        },
      },
    }).then((items) =>
      items.map((item) => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        contentFormat: item.contentFormat,
        topicTitle: item.topic?.title || null,
        keywords: item.topic?.keywords || [],
        templateName: item.template?.name || null,
      })),
    );
  }

  // 采集趋势数据（最近 N 天）
  async getCollectionTrends(days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const materials = await this.prisma.material.findMany({
      where: { collectDate: { gte: startDate } },
      select: { collectDate: true, platform: true },
      orderBy: { collectDate: 'asc' },
    });

    // 按日期分组统计
    const trendMap: Record<string, Record<string, number>> = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const key = date.toISOString().split('T')[0];
      trendMap[key] = {};
    }

    for (const m of materials) {
      const key = m.collectDate.toISOString().split('T')[0];
      if (trendMap[key]) {
        trendMap[key][m.platform] = (trendMap[key][m.platform] || 0) + 1;
      }
    }

    return Object.entries(trendMap).map(([date, platforms]) => ({
      date,
      total: Object.values(platforms).reduce((a, b) => a + b, 0),
      ...platforms,
    }));
  }

  // 创作趋势数据
  async getCreationTrends(days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const articles = await this.prisma.article.findMany({
      where: { createdAt: { gte: startDate } },
      select: { createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const trendMap: Record<string, { draft: number; published: number }> = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const key = date.toISOString().split('T')[0];
      trendMap[key] = { draft: 0, published: 0 };
    }

    for (const a of articles) {
      const key = a.createdAt.toISOString().split('T')[0];
      if (trendMap[key]) {
        if (a.status === 'published') {
          trendMap[key].published++;
        } else {
          trendMap[key].draft++;
        }
      }
    }

    return Object.entries(trendMap).map(([date, counts]) => ({
      date,
      ...counts,
      total: counts.draft + counts.published,
    }));
  }
}
