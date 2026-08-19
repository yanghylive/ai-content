import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import type { StatsSnapshot, StatsMetric } from './stats.types';

/**
 * 统一统计快照服务（方案 4.3 状态事实源）。
 * 前端不再从多个接口自行拼数量，改由本服务按域返回统一 StatsSnapshot。
 * 事实源统一采用 Prisma 表（方案 4.1 核心对象），消除 growth store 与
 * Prisma lead 表两套「线索」口径的打架。
 */

/** 指标规范元数据（方案 10.2：计算公式/归因窗口/平台缺失说明），按 key 集中登记 */
const METRIC_META: Record<
  string,
  {
    formula?: string;
    attributionWindow?: string;
    platformGap?: string | null;
  }
> = {
  'today.leads': {
    formula: 'COUNT(leads) WHERE updatedAt >= 今日 00:00 AND userId = 当前用户',
    attributionWindow: '当日更新口径（非归因窗口）',
    platformGap: null,
  },
  'today.high_intent': {
    formula: 'COUNT(leads) WHERE score >= 75 AND status != blocked',
    attributionWindow: '累计存量口径',
    platformGap: null,
  },
  'today.materials': {
    formula: 'COUNT(materials) WHERE collectDate >= 今日 00:00',
    attributionWindow: '当日采集口径',
    platformGap: '视频号/微信素材采集未接入，不计入',
  },
  'today.waiting': {
    formula:
      "COUNT(interaction_tasks) WHERE status = 'WAITING_FOR_SEND_CONFIRMATION'",
    attributionWindow: '当前时点快照',
    platformGap: null,
  },
  'today.failed_publish': {
    formula: "COUNT(publish_records) WHERE status = 'failed'",
    attributionWindow: '全量累计（未限当日）',
    platformGap: null,
  },
  'weekly.content': {
    formula: 'COUNT(articles) WHERE createdAt >= 近7天',
    attributionWindow: '近 7 天创建口径',
    platformGap: null,
  },
  'weekly.publish': {
    formula: 'COUNT(publish_records) WHERE createdAt >= 近7天',
    attributionWindow: '近 7 天创建口径',
    platformGap: null,
  },
  'weekly.interaction': {
    formula: 'COUNT(interaction_tasks) WHERE createdAt >= 近7天',
    attributionWindow: '近 7 天创建口径',
    platformGap: null,
  },
  'weekly.leads': {
    formula: 'COUNT(leads) WHERE createdAt >= 近7天',
    attributionWindow: '近 7 天创建口径',
    platformGap: null,
  },
  'weekly.qualified': {
    formula: "COUNT(leads) WHERE createdAt >= 近7天 AND status = 'qualified'",
    attributionWindow: '近 7 天创建口径',
    platformGap: null,
  },
  'weekly.converted': {
    formula: "COUNT(leads) WHERE createdAt >= 近7天 AND status = 'converted'",
    attributionWindow: '近 7 天创建口径',
    platformGap: null,
  },
  'weekly.won': {
    formula:
      "COUNT(crm_opportunities) WHERE createdAt >= 近7天 AND stage = 'won'",
    attributionWindow: '近 7 天创建口径',
    platformGap: null,
  },
  'approval.waiting_tasks': {
    formula:
      "COUNT(interaction_tasks) WHERE status = 'WAITING_FOR_SEND_CONFIRMATION'",
    attributionWindow: '当前时点快照',
    platformGap: null,
  },
  'approval.agent_confirmations': {
    formula: "COUNT(agent_confirmations) WHERE status = 'pending'",
    attributionWindow: '当前时点快照',
    platformGap: null,
  },
  'growth.funnel.candidates': {
    formula: 'SUM(growth_acquisition_runs.candidate_count)',
    attributionWindow: '累计运行口径',
    platformGap: null,
  },
  'growth.funnel.selected': {
    formula: 'SUM(growth_acquisition_runs.selected_count)',
    attributionWindow: '累计运行口径',
    platformGap: null,
  },
  'growth.funnel.contacted': {
    formula: 'SUM(growth_acquisition_runs.contacted_count)',
    attributionWindow: '累计运行口径',
    platformGap: null,
  },
  'growth.funnel.crm_captured': {
    formula: 'COUNT(leads) WHERE customer_id IS NOT NULL',
    attributionWindow: '累计存量口径',
    platformGap: null,
  },
  'growth.funnel.converted': {
    formula: "COUNT(leads) WHERE status = 'converted'",
    attributionWindow: '累计存量口径',
    platformGap: null,
  },
  'growth.today_leads': {
    formula: 'COUNT(leads) WHERE updatedAt >= 今日 00:00',
    attributionWindow: '当日更新口径',
    platformGap: null,
  },
  'growth.active_configs': {
    formula: "COUNT(growth_acquisition_configs) WHERE status = 'enabled'",
    attributionWindow: '当前时点快照',
    platformGap: null,
  },
  'growth.high_intent': {
    formula: 'COUNT(leads) WHERE score >= 75 AND status != blocked',
    attributionWindow: '累计存量口径',
    platformGap: null,
  },
  'account_health.total': {
    formula: 'COUNT(发布引擎返回的获客账号) DISTINCT platform:accountId',
    attributionWindow: '实时检测口径（validate=true）',
    platformGap: '仅统计本地发布引擎可见账号',
  },
  'account_health.ready': {
    formula: 'COUNT(账号) WHERE status = 1（在线）',
    attributionWindow: '实时检测口径',
    platformGap: null,
  },
  'account_health.expired': {
    formula: 'COUNT(账号) WHERE status != 1',
    attributionWindow: '实时检测口径',
    platformGap: null,
  },
  'account_health.blocked_tasks': {
    formula: 'COUNT(waitingTasks) WHERE 关联账号失效',
    attributionWindow: '实时检测口径',
    platformGap: null,
  },
};

/** 按样本量给出置信度（方案 10.2） */
function resolveConfidence(value: number | null, sampleSize: number) {
  if (value === null) return 'none' as const;
  if (sampleSize === 0) return 'none' as const;
  if (sampleSize < 10) return 'low' as const;
  if (sampleSize < 100) return 'medium' as const;
  return 'high' as const;
}

/** 给指标补 10.2 元数据（公式/归因窗口/平台缺失/样本量/置信度） */
function decorateMetric(metric: StatsMetric): StatsMetric {
  const meta = METRIC_META[metric.key];
  // 计数型指标的样本量 = 数值本身（无数据则样本量 0）
  const sampleSize = typeof metric.value === 'number' ? metric.value : 0;
  return {
    ...metric,
    formula: meta?.formula,
    attributionWindow: meta?.attributionWindow,
    platformGap: meta?.platformGap ?? null,
    sampleSize,
    confidence: resolveConfidence(metric.value, sampleSize),
  };
}
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly autoUpload?: AutoUploadService,
  ) {}

  async getSnapshot(domain: string): Promise<StatsSnapshot> {
    // 10.2 指标规范：统一出口补公式/归因窗口/平台缺失/样本量/置信度元数据
    switch (domain) {
      case 'today':
        return this.withMetricMeta(this.getTodaySnapshot());
      case 'approval':
        return this.withMetricMeta(this.getApprovalSnapshot());
      case 'growth':
        return this.withMetricMeta(this.getGrowthSnapshot());
      case 'account-health':
        return this.withMetricMeta(this.getAccountHealthSnapshot());
      default:
        return {
          domain,
          generatedAt: new Date().toISOString(),
          metrics: [],
        };
    }
  }

  private async withMetricMeta(
    snapshot: Promise<StatsSnapshot>,
  ): Promise<StatsSnapshot> {
    const resolved = await snapshot;
    return {
      ...resolved,
      metrics: resolved.metrics.map(decorateMetric),
    };
  }

  private resolveUserId(): string {
    return (
      this.authRequestContext?.get()?.user?.id?.trim() || 'legacy-local-user'
    );
  }

  /** 审批 /approval 域：统一「待确认」口径（方案 P0-01 治本） */
  private async getApprovalSnapshot(): Promise<StatsSnapshot> {
    const userId = this.resolveUserId();
    const now = new Date();

    const [waitingTasks, agentConfirmations] = await Promise.all([
      this.prisma.interactionTask.count({
        where: { userId, status: 'WAITING_FOR_SEND_CONFIRMATION' },
      }),
      this.prisma.agentConfirmation.count({
        where: { userId, status: 'pending' },
      }),
    ]);

    const syncedAt = now.toISOString();
    const m = (
      key: string,
      label: string,
      value: number,
      definition: string,
    ): StatsMetric => ({
      key,
      label,
      value,
      period: 'now',
      definition,
      lastSyncedAt: syncedAt,
      dataQuality: 'complete',
    });

    return {
      domain: 'approval',
      generatedAt: syncedAt,
      metrics: [
        m(
          'approval.waiting_tasks',
          '待确认互动任务',
          waitingTasks,
          '等待发送确认的互动任务数',
        ),
        m(
          'approval.agent_confirmations',
          'Agent 高风险确认',
          agentConfirmations,
          '待人工确认的 Agent 高风险动作数',
        ),
      ],
    };
  }

  /** 经营 /growth 域：获客漏斗统一累计口径（方案 P0-02 / 10.1 治本） */
  private async getGrowthSnapshot(): Promise<StatsSnapshot> {
    const userId = this.resolveUserId();
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const [runs, leads, activeConfigs] = await Promise.all([
      this.prisma.growthAcquisitionRun.findMany({
        where: { userId },
        select: {
          candidateCount: true,
          selectedCount: true,
          contactedCount: true,
        },
      }),
      this.prisma.lead.findMany({
        where: { userId },
        select: {
          customerId: true,
          status: true,
          score: true,
          updatedAt: true,
        },
      }),
      this.prisma.growthAcquisitionConfig.count({
        where: { userId, status: 'enabled' },
      }),
    ]);

    const candidates = runs.reduce((s, r) => s + r.candidateCount, 0);
    const selected = runs.reduce((s, r) => s + r.selectedCount, 0);
    const contacted = runs.reduce((s, r) => s + r.contactedCount, 0);
    const crmCaptured = leads.filter((l) => l.customerId).length;
    const converted = leads.filter((l) => l.status === 'converted').length;
    const todayLeads = leads.filter((l) => l.updatedAt >= today).length;
    const highIntent = leads.filter(
      (l) => l.score >= 75 && l.status !== 'blocked',
    ).length;

    const syncedAt = now.toISOString();
    const m = (
      key: string,
      label: string,
      value: number,
      period: string,
      definition: string,
    ): StatsMetric => ({
      key,
      label,
      value,
      period,
      definition,
      lastSyncedAt: syncedAt,
      dataQuality: 'complete',
    });

    return {
      domain: 'growth',
      generatedAt: syncedAt,
      metrics: [
        m(
          'growth.funnel.candidates',
          '候选',
          candidates,
          'cumulative',
          '获客运行累计候选数',
        ),
        m(
          'growth.funnel.selected',
          '选中',
          selected,
          'cumulative',
          '获客运行累计选中数',
        ),
        m(
          'growth.funnel.contacted',
          '已触达',
          contacted,
          'cumulative',
          '获客运行累计触达数',
        ),
        m(
          'growth.funnel.crm_captured',
          '进 CRM',
          crmCaptured,
          'cumulative',
          '已关联 CRM 客户的线索数（统一 leads 表）',
        ),
        m(
          'growth.funnel.converted',
          '转化',
          converted,
          'cumulative',
          '状态为 converted 的线索数',
        ),
        m(
          'growth.today_leads',
          '今日新线索',
          todayLeads,
          'today',
          '今日更新过的线索数',
        ),
        m(
          'growth.active_configs',
          '启用中配置',
          activeConfigs,
          'now',
          '状态为 enabled 的获客配置数',
        ),
        m(
          'growth.high_intent',
          '高意向线索',
          highIntent,
          'cumulative',
          '评分 ≥75 且未屏蔽的线索数',
        ),
      ],
    };
  }

  /** 账号健康 /account-health 域：复用 AutoUploadService 实时检测（方案 P0-03 治本） */
  private async getAccountHealthSnapshot(): Promise<StatsSnapshot> {
    const now = new Date();
    const syncedAt = now.toISOString();

    // 账号实时状态来自本地发布引擎（validate 实时检测），本地引擎不可用则返回 N/A（null）
    const health = this.autoUpload
      ? await this.autoUpload
          .getAccountHealth({ validate: true })
          .catch(() => null)
      : null;

    const q = health ? 'complete' : 'missing';
    const m = (
      key: string,
      label: string,
      value: number | null,
      definition: string,
    ): StatsMetric => ({
      key,
      label,
      value,
      period: 'now',
      definition,
      lastSyncedAt: syncedAt,
      dataQuality: q,
    });

    return {
      domain: 'account-health',
      generatedAt: syncedAt,
      metrics: [
        m(
          'account_health.total',
          '总账号',
          health?.totalAccounts ?? null,
          '获客账号总数',
        ),
        m(
          'account_health.ready',
          '正常',
          health?.readyAccounts ?? null,
          '在线可用（status=1）的获客账号数',
        ),
        m(
          'account_health.expired',
          '需处理',
          health?.expiredAccounts ?? null,
          '失效或需人工的获客账号数',
        ),
        m(
          'account_health.blocked_tasks',
          '阻塞任务',
          health?.waitingTasks?.length ?? null,
          '因账号失效而阻塞的待发布任务数',
        ),
      ],
    };
  }

  /** 工作台 /today 域：今日卡片 5 项 + 周报 7 项，统一 Prisma 事实源 */
  private async getTodaySnapshot(): Promise<StatsSnapshot> {
    const userId = this.resolveUserId();
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      todayLeads,
      highIntent,
      todayMaterials,
      waitingConfirmations,
      failedPublish,
      content7d,
      publish7d,
      interaction7d,
      leads7d,
      qualified7d,
      converted7d,
      won7d,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: { userId, updatedAt: { gte: today } },
      }),
      this.prisma.lead.count({
        where: { userId, score: { gte: 75 }, status: { not: 'blocked' } },
      }),
      this.prisma.material.count({ where: { collectDate: { gte: today } } }),
      this.prisma.interactionTask.count({
        where: { userId, status: 'WAITING_FOR_SEND_CONFIRMATION' },
      }),
      this.prisma.publishRecord.count({ where: { status: 'failed' } }),
      this.prisma.article.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.publishRecord.count({
        where: { createdAt: { gte: since7d } },
      }),
      this.prisma.interactionTask.count({
        where: { createdAt: { gte: since7d } },
      }),
      this.prisma.lead.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.lead.count({
        where: { createdAt: { gte: since7d }, status: 'qualified' },
      }),
      this.prisma.lead.count({
        where: { createdAt: { gte: since7d }, status: 'converted' },
      }),
      this.prisma.crmOpportunity.count({
        where: { createdAt: { gte: since7d }, stage: 'won' },
      }),
    ]);

    const syncedAt = now.toISOString();
    const m = (
      key: string,
      label: string,
      value: number,
      period: string,
      definition: string,
    ): StatsMetric => ({
      key,
      label,
      value,
      period,
      definition,
      lastSyncedAt: syncedAt,
      dataQuality: 'complete',
    });

    return {
      domain: 'today',
      generatedAt: syncedAt,
      metrics: [
        m(
          'today.leads',
          '今日新线索',
          todayLeads,
          'today',
          '今日更新过的线索数（统一 leads 表）',
        ),
        m(
          'today.high_intent',
          '高意向线索',
          highIntent,
          'today',
          '评分 ≥75 且未屏蔽的线索数',
        ),
        m(
          'today.materials',
          '今日素材',
          todayMaterials,
          'today',
          '今日采集入库的素材数',
        ),
        m(
          'today.waiting',
          '待确认',
          waitingConfirmations,
          'today',
          '等待发送确认的互动任务数',
        ),
        m(
          'today.failed_publish',
          '发布失败',
          failedPublish,
          'today',
          '状态为失败的发布记录数',
        ),
        m(
          'weekly.content',
          '本周内容',
          content7d,
          'last_7_days',
          '近 7 天生成的文章数',
        ),
        m(
          'weekly.publish',
          '本周发布',
          publish7d,
          'last_7_days',
          '近 7 天创建的发布记录数',
        ),
        m(
          'weekly.interaction',
          '本周互动',
          interaction7d,
          'last_7_days',
          '近 7 天创建的互动任务数',
        ),
        m(
          'weekly.leads',
          '本周线索',
          leads7d,
          'last_7_days',
          '近 7 天新增线索数',
        ),
        m(
          'weekly.qualified',
          '本周合格线索',
          qualified7d,
          'last_7_days',
          '近 7 天合格线索数',
        ),
        m(
          'weekly.converted',
          '本周转化',
          converted7d,
          'last_7_days',
          '近 7 天转客户线索数',
        ),
        m('weekly.won', '本周成交', won7d, 'last_7_days', '近 7 天赢单商机数'),
      ],
    };
  }
}
