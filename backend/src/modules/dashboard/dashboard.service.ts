import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { VideoWorkshopService } from '../video-workshop/video-workshop.service';
import {
  normalizeTaskStatus,
  type TaskModuleName,
  type UnifiedTaskStatus,
} from './unified-task-status';

export type RiskAuditEvidence = {
  id: string;
  auditId: string;
  action: string;
  actionLabel: string;
  riskLevel: 'medium' | 'high' | 'unknown';
  status: 'allowed';
  targetLabel: string;
  targetId?: string;
  requestedCount?: number;
  affectedCount?: number;
  detail?: string;
  details?: RiskAuditEvidenceDetail[];
  summary: string;
  source: 'system-log';
  sourceLogId: string;
  level: string;
  createdAt: Date;
  rawContent: string;
};

export type RiskAuditEvidenceChecklistItem = {
  label: string;
  checked: boolean;
};

export type RiskAuditEvidenceIssue = {
  code: string;
  scope: string;
  stage: string;
  message: string;
  nextAction: string;
  platform?: string;
  account?: string;
  field?: string;
  filePath?: string;
};

export type RiskAuditEvidenceDetail = {
  type: string;
  label: string;
  platform?: string;
  accountId?: string;
  operator?: string;
  confirmedAt?: string;
  confirmationId?: string;
  confirmedAction?: string;
  confirmedRiskLevel?: string;
  reason?: string;
  checklist?: RiskAuditEvidenceChecklistItem[];
  fullPermission?: boolean;
  status?: string;
  statusLabel?: string;
  summary?: string;
  failureReason?: string;
  nextAction?: string;
  publishTaskId?: string;
  publishUrl?: string;
  externalId?: string;
  evidenceSource?: string;
  evidenceUrl?: string;
  contentKind?: string;
  title?: string;
  materialCount?: number;
  coverCount?: number;
  tagCount?: number;
  scheduleSummary?: string;
  dryRun?: boolean;
  ok?: boolean;
  checkedAt?: string;
  issueCount?: number;
  payloadCount?: number;
  accountCount?: number;
  issues?: RiskAuditEvidenceIssue[];
};

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private systemLogsService: SystemLogsService,
    @Optional()
    private readonly videoWorkshop?: VideoWorkshopService,
  ) {}

  // 获取最近的系统运行日志
  getSystemLogs(limit: number = 50) {
    return this.systemLogsService.getRecent(limit);
  }

  /**
   * 归因链（阶段 B）：从一篇内容出发，查它的发布记录 + 互动任务 + 线索。
   * 强关联：PublishRecord.articleId + InteractionTask.sourceArticleId。
   * 弱关联（互动→线索）：InteractionTask.sourceUrl 匹配 Lead.sourceUrl（平台同一条评论/内容）。
   */
  async resolveContentAttribution(articleId: string) {
    const [article, publishRecords, interactionTasks] = await Promise.all([
      this.prisma.article.findUnique({ where: { id: articleId } }),
      this.prisma.publishRecord.findMany({
        where: { articleId },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.interactionTask.findMany({
        where: { sourceArticleId: articleId },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    // 互动 → 线索：通过 sourceUrl 弱关联匹配（同一平台来源的评论/内容）
    const sourceUrls = interactionTasks
      .map((task) => task.sourceUrl)
      .filter((url): url is string => Boolean(url));
    const leads =
      sourceUrls.length > 0
        ? await this.prisma.lead.findMany({
            where: { sourceUrl: { in: sourceUrls } },
            orderBy: { createdAt: 'desc' },
          })
        : [];
    return {
      article,
      publishCount: publishRecords.length,
      interactionCount: interactionTasks.length,
      leadCount: leads.length,
      publishRecords,
      interactionTasks,
      leads,
    };
  }

  /**
   * 统一任务中心（报告 16.3 第 14 项）：聚合 auto-upload / interaction /
   * local-engine / video-workshop 四套任务列表，归一成统一状态。
   */
  async unifiedTaskCenter(limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    const [publishRecords, interactionTasks, runtimeExecutions, videoTasks] =
      await Promise.all([
        this.prisma.publishRecord.findMany({
          where: { status: { in: ['pending', 'failed'] } },
          orderBy: { updatedAt: 'desc' },
          take,
        }),
        this.prisma.interactionTask.findMany({
          where: {
            status: {
              notIn: ['COMPLETED', 'SKIPPED', 'NO_TARGET'],
            },
          },
          orderBy: { updatedAt: 'desc' },
          take,
        }),
        this.prisma.runtimeExecution.findMany({
          where: { status: { notIn: ['completed', 'done', 'success'] } },
          orderBy: { updatedAt: 'desc' },
          take,
        }),
        this.videoWorkshop
          ? this.videoWorkshop.listTasks(take).catch(() => [])
          : Promise.resolve([]),
      ]);

    type UnifiedTaskItem = {
      module: TaskModuleName;
      id: string;
      title: string;
      status: UnifiedTaskStatus;
      updatedAt: Date;
    };
    const items: UnifiedTaskItem[] = [
      ...publishRecords.map((r) => ({
        module: 'auto-upload' as const,
        id: r.id,
        title: r.publishUrl || r.accountId || `发布任务 ${r.id}`,
        status: normalizeTaskStatus('auto-upload', r.status),
        updatedAt: r.updatedAt,
      })),
      ...interactionTasks.map((t) => ({
        module: 'interaction' as const,
        id: t.id,
        title: t.currentTarget || t.taskType || `互动任务 ${t.id}`,
        status: normalizeTaskStatus('interaction', t.status),
        updatedAt: t.updatedAt,
      })),
      ...runtimeExecutions.map((e) => ({
        module: 'local-engine' as const,
        id: e.id,
        title: e.userMessage || e.taskType || `执行任务 ${e.id}`,
        status: normalizeTaskStatus('local-engine', e.status),
        updatedAt: e.updatedAt,
      })),
      ...videoTasks.map((t) => ({
        module: 'video-workshop' as const,
        id: t.id,
        title: t.stage || (t.kind === 'render' ? '视频渲染' : '视频下载'),
        status: normalizeTaskStatus('video-workshop', t.status),
        updatedAt: new Date(t.updatedAt),
      })),
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return { total: items.length, items: items.slice(0, take) };
  }

  async getRiskAuditEvidence(limit: number = 50) {
    const take = this.normalizeLimit(limit);
    const rows = await this.prisma.systemLog.findMany({
      where: {
        content: {
          contains: 'audit=risk_',
        },
      },
      orderBy: { createdAt: 'desc' },
      take: take * 2,
      select: {
        id: true,
        content: true,
        level: true,
        createdAt: true,
      },
    });

    return rows
      .map((row) => this.parseRiskAuditLog(row))
      .filter((item): item is RiskAuditEvidence => Boolean(item))
      .slice(0, take);
  }

  // 核心指标统计 (新版：关注行动与质量转化)
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. 今日采集素材量 & 成功率
    const [todayMaterials, todayFailedMaterials] = await Promise.all([
      this.prisma.material.count({ where: { collectDate: { gte: today } } }),
      this.prisma.material.count({
        where: { collectDate: { gte: today }, status: 'failed' },
      }),
    ]);
    const successRate =
      todayMaterials > 0
        ? (
            ((todayMaterials - todayFailedMaterials) / todayMaterials) *
            100
          ).toFixed(1)
        : '0.0';

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
      take: 20,
    });

    if (recentHighTopics.length > 0) {
      const keywordCounts: Record<string, number> = {};
      recentHighTopics.forEach((t) => {
        asStringArray(t.keywords).forEach((k) => {
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

  private normalizeLimit(value: number) {
    if (!Number.isFinite(value)) return 50;
    return Math.min(Math.max(Math.trunc(value), 1), 100);
  }

  private parseRiskAuditLog(row: {
    id: string;
    content: string;
    level: string;
    createdAt: Date;
  }): RiskAuditEvidence | null {
    const auditId = row.content.match(/audit=(risk_[^,，)）\s]+)/)?.[1];
    if (!auditId) return null;

    const singleMaterialMatch = row.content.match(
      /^素材删除已确认：(.+?)（id=([^,，]+),\s*audit=(risk_[^)）\s]+)[)）]/,
    );
    if (singleMaterialMatch) {
      const targetLabel = singleMaterialMatch[1]?.trim() || '素材';
      return {
        id: `${row.id}:${auditId}`,
        auditId,
        action: 'material-delete',
        actionLabel: '删除素材',
        riskLevel: 'medium',
        status: 'allowed',
        targetLabel,
        targetId: singleMaterialMatch[2]?.trim(),
        affectedCount: 1,
        summary: `已确认删除素材：${targetLabel}`,
        source: 'system-log',
        sourceLogId: row.id,
        level: row.level,
        createdAt: row.createdAt,
        rawContent: row.content,
      };
    }

    const batchMaterialMatch = row.content.match(
      /^素材批量删除已确认：请求\s*(\d+)\s*条，实际删除\s*(\d+)\s*条（audit=(risk_[^)）\s]+)[)）]/,
    );
    if (batchMaterialMatch) {
      const requestedCount = Number(batchMaterialMatch[1]);
      const affectedCount = Number(batchMaterialMatch[2]);
      return {
        id: `${row.id}:${auditId}`,
        auditId,
        action: 'material-batch-delete',
        actionLabel: '批量删除素材',
        riskLevel: 'high',
        status: 'allowed',
        targetLabel: `${affectedCount} 条素材`,
        requestedCount,
        affectedCount,
        summary: `已确认批量删除素材：请求 ${requestedCount} 条，实际删除 ${affectedCount} 条`,
        source: 'system-log',
        sourceLogId: row.id,
        level: row.level,
        createdAt: row.createdAt,
        rawContent: row.content,
      };
    }

    const genericRiskMatch = row.content.match(
      /^风险审计已确认：(.+?)（(.+)[)）]$/,
    );
    if (genericRiskMatch) {
      const actionLabel = genericRiskMatch[1]?.trim() || '风险审计';
      const attributes = this.parseRiskAuditAttributes(genericRiskMatch[2]);
      const action = attributes.action || 'unknown-risk-audit';
      const targetLabel = attributes.target || '系统操作';
      const risk = attributes.risk;
      const detail = attributes.detail;
      const details = this.decodeRiskAuditDetails(attributes.details);
      const riskLevel = risk === 'high' || risk === 'medium' ? risk : 'unknown';

      return {
        id: `${row.id}:${auditId}`,
        auditId,
        action,
        actionLabel,
        riskLevel,
        status: 'allowed',
        targetLabel,
        detail,
        details,
        summary: `已确认${actionLabel}：${targetLabel}`,
        source: 'system-log',
        sourceLogId: row.id,
        level: row.level,
        createdAt: row.createdAt,
        rawContent: row.content,
      };
    }

    return {
      id: `${row.id}:${auditId}`,
      auditId,
      action: 'unknown-risk-audit',
      actionLabel: '风险审计',
      riskLevel: 'unknown',
      status: 'allowed',
      targetLabel: '系统操作',
      summary: row.content,
      source: 'system-log',
      sourceLogId: row.id,
      level: row.level,
      createdAt: row.createdAt,
      rawContent: row.content,
    };
  }

  private parseRiskAuditAttributes(value: string) {
    return value.split(',').reduce<Record<string, string>>((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex <= 0) return acc;
      const key = part.slice(0, separatorIndex).trim();
      const itemValue = part.slice(separatorIndex + 1).trim();
      if (key) {
        acc[key] = itemValue;
      }
      return acc;
    }, {});
  }

  private decodeRiskAuditDetails(
    encoded?: string,
  ): RiskAuditEvidenceDetail[] | undefined {
    if (!encoded) return undefined;
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      if (!Array.isArray(parsed)) return undefined;
      const details = parsed
        .map((item) => this.toRiskAuditEvidenceDetail(item))
        .filter((item): item is RiskAuditEvidenceDetail => Boolean(item));
      return details.length ? details : undefined;
    } catch {
      return undefined;
    }
  }

  private toRiskAuditEvidenceDetail(
    value: unknown,
  ): RiskAuditEvidenceDetail | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const label = this.optionalString(record.label);
    const summary = this.optionalString(record.summary);
    if (!label && !summary) return null;

    return {
      type: this.optionalString(record.type) || 'detail',
      label: label || summary || '证据详情',
      platform: this.optionalString(record.platform),
      accountId: this.optionalString(record.accountId),
      operator: this.optionalString(record.operator),
      confirmedAt: this.optionalString(record.confirmedAt),
      confirmationId: this.optionalString(record.confirmationId),
      confirmedAction: this.optionalString(record.confirmedAction),
      confirmedRiskLevel: this.optionalString(record.confirmedRiskLevel),
      reason: this.optionalString(record.reason),
      checklist: this.toRiskAuditChecklist(record.checklist),
      fullPermission: this.optionalBoolean(record.fullPermission),
      status: this.optionalString(record.status),
      statusLabel: this.optionalString(record.statusLabel),
      summary,
      failureReason: this.optionalString(record.failureReason),
      nextAction: this.optionalString(record.nextAction),
      publishTaskId: this.optionalString(record.publishTaskId),
      publishUrl: this.optionalString(record.publishUrl),
      externalId: this.optionalString(record.externalId),
      evidenceSource: this.optionalString(record.evidenceSource),
      evidenceUrl: this.optionalString(record.evidenceUrl),
      contentKind: this.optionalString(record.contentKind),
      title: this.optionalString(record.title),
      materialCount: this.optionalNumber(record.materialCount),
      coverCount: this.optionalNumber(record.coverCount),
      tagCount: this.optionalNumber(record.tagCount),
      scheduleSummary: this.optionalString(record.scheduleSummary),
      dryRun: this.optionalBoolean(record.dryRun),
      ok: this.optionalBoolean(record.ok),
      checkedAt: this.optionalString(record.checkedAt),
      issueCount: this.optionalNumber(record.issueCount),
      payloadCount: this.optionalNumber(record.payloadCount),
      accountCount: this.optionalNumber(record.accountCount),
      issues: this.toRiskAuditIssues(record.issues),
    };
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private optionalNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private optionalBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : undefined;
  }

  private toRiskAuditChecklist(
    value: unknown,
  ): RiskAuditEvidenceChecklistItem[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }
        const record = item as Record<string, unknown>;
        const label = this.optionalString(record.label);
        if (!label) return null;
        return {
          label,
          checked: record.checked === true,
        };
      })
      .filter((item): item is RiskAuditEvidenceChecklistItem => item !== null);
    return items.length ? items : undefined;
  }

  private toRiskAuditIssues(
    value: unknown,
  ): RiskAuditEvidenceIssue[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.reduce<RiskAuditEvidenceIssue[]>((items, item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return items;
      }
      const record = item as Record<string, unknown>;
      const code = this.optionalString(record.code);
      const scope = this.optionalString(record.scope);
      const stage = this.optionalString(record.stage);
      const message = this.optionalString(record.message);
      const nextAction = this.optionalString(record.nextAction);
      if (!code || !scope || !stage || !message || !nextAction) {
        return items;
      }
      items.push({
        code,
        scope,
        stage,
        message,
        nextAction,
        platform: this.optionalString(record.platform),
        account: this.optionalString(record.account),
        field: this.optionalString(record.field),
        filePath: this.optionalString(record.filePath),
      });
      return items;
    }, []);
    return items.length ? items : undefined;
  }

  // 获取关键词矩阵分析数据 (高分风向词 vs 抓取热词)
  async getKeywordMatrix() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 1. 高分风向词 (近7天 aiScore > 80)
    const highTopics = await this.prisma.topic.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, aiScore: { gt: 80 } },
      select: { keywords: true },
    });

    const highWordsCount: Record<string, number> = {};
    highTopics.forEach((t) => {
      asStringArray(t.keywords).forEach((k) => {
        if (k.trim().length > 1) {
          // 过滤掉单字
          highWordsCount[k] = (highWordsCount[k] || 0) + 1;
        }
      });
    });

    // 2. 抓取素材热榜 (近3天)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const materials = await this.prisma.material.findMany({
      where: { collectDate: { gte: threeDaysAgo } },
      select: { keywords: true },
    });

    const materialWordsCount: Record<string, number> = {};
    materials.forEach((m) => {
      asStringArray(m.keywords).forEach((k) => {
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
      trendingMaterialKeywords: formatWords(materialWordsCount, 30),
    };
  }

  // 获取最新待发布草稿
  async getLatestDraftArticles(limit: number = 50, keyword?: string) {
    return this.prisma.article
      .findMany({
        where: {
          status: 'draft',
          ...(keyword ? { title: { contains: keyword } } : {}),
        },
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
      })
      .then((items) =>
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
