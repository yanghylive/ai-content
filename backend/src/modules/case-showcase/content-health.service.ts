import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 内容健康服务（M6 · PRD §9.14 授权到期 + §9.15 链接健康度 + §12 内容复核）。
 *
 * 让内容运营无需依赖研发即可维护案例：
 *   - checkAuthorizationExpiry()：扫描 reviewStatus=approved 的授权记录，
 *     validUntil 在 30/7 天内到期 → 返回待提醒清单；
 *   - checkReviewDue()：扫描 status=published 且 nextReviewAt 已过/7 天内到期
 *     的案例 → 返回待复核清单；
 *   - getDemoEndpointHealth()：聚合演示入口 healthStatus + 异常明细（负责人）。
 *
 * 当前先落日志 + 返回清单，M7 再接真实通知渠道（企微/邮件）。
 * 定时任务复用全局 ScheduleModule（@Cron），方法与 cron 分离，可被后台直接调用。
 */

/** 授权到期提醒窗口（天）：30 天 */
export const AUTHORIZATION_EXPIRY_WINDOW_DAYS = 30;
/** 授权到期加急窗口（天）：7 天 */
export const AUTHORIZATION_EXPIRY_URGENT_DAYS = 7;
/** 内容复核提醒窗口（天）：nextReviewAt 距今 7 天内（含已逾期） */
export const REVIEW_DUE_WINDOW_DAYS = 7;
/** 可自动检查的演示入口类型（与 link-health-check 保持一致，小程序码/预约人工验证） */
export const HEALTH_CHECK_ENDPOINT_TYPES = ['web', 'h5', 'download'] as const;

export type ExpiryWindow = '7d' | '30d';

export interface AuthorizationExpiryItem {
  id: string;
  caseId: string;
  recordType: string;
  grantor: string | null;
  licenseName: string | null;
  validUntil: string;
  /** 距到期自然日（0=今日到期，负值=已过期） */
  daysRemaining: number;
  window: ExpiryWindow;
}

export interface ReviewDueItem {
  id: string;
  slug: string;
  title: string;
  status: string;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  ownerUserId: string | null;
  /** 距复核自然日（负值=已逾期） */
  daysRemaining: number;
  overdue: boolean;
}

export interface DemoEndpointHealthSummary {
  total: number;
  healthy: number;
  warning: number;
  broken: number;
  expired: number;
  unknown: number;
}

export interface DemoEndpointAnomaly {
  endpointId: string;
  caseId: string;
  caseSlug: string;
  caseTitle: string;
  endpointType: string;
  healthStatus: string;
  lastCheckedAt: string | null;
  ownerUserId: string | null;
}

export interface ContentHealthSnapshot {
  generatedAt: string;
  authorizationsExpiring: AuthorizationExpiryItem[];
  reviewsDue: ReviewDueItem[];
}

/** 距目标日期还有多少自然日（向上取整；负值=已过期/逾期；无效值返回 0） */
export function daysUntil(
  target: Date | string | null | undefined,
  now: Date = new Date(),
): number {
  if (!target) return 0;
  const time =
    target instanceof Date ? target.getTime() : new Date(target).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.ceil((time - now.getTime()) / (24 * 3600 * 1000));
}

/** 授权到期窗口判定：0~7 天 → 7d；8~30 天 → 30d；其余（已过期/超 30 天）→ null */
export function expiryWindowOf(daysRemaining: number): ExpiryWindow | null {
  if (
    daysRemaining < 0 ||
    daysRemaining > AUTHORIZATION_EXPIRY_WINDOW_DAYS
  ) {
    return null;
  }
  return daysRemaining <= AUTHORIZATION_EXPIRY_URGENT_DAYS ? '7d' : '30d';
}

function toIsoString(value: Date | null): string {
  return value ? value.toISOString() : '';
}

@Injectable()
export class ContentHealthService {
  private readonly logger = new Logger(ContentHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 每日内容健康检查（授权到期 + 内容复核），先日志，M7 接通知渠道 */
  @Cron('0 2 * * *')
  async runDailyContentHealthCheck(): Promise<ContentHealthSnapshot> {
    try {
      const [authorizationsExpiring, reviewsDue] = await Promise.all([
        this.checkAuthorizationExpiry(),
        this.checkReviewDue(),
      ]);
      if (authorizationsExpiring.length > 0) {
        this.logger.warn(
          `授权到期提醒：${authorizationsExpiring.length} 条授权将在 ${AUTHORIZATION_EXPIRY_WINDOW_DAYS} 天内到期`,
        );
      }
      if (reviewsDue.length > 0) {
        this.logger.warn(
          `内容复核提醒：${reviewsDue.length} 个已发布案例待复核`,
        );
      }
      return {
        generatedAt: new Date().toISOString(),
        authorizationsExpiring,
        reviewsDue,
      };
    } catch (error) {
      this.logger.error(
        `内容健康检查任务失败：${this.errorMessage(error)}`,
      );
      return {
        generatedAt: new Date().toISOString(),
        authorizationsExpiring: [],
        reviewsDue: [],
      };
    }
  }

  /** 授权到期提醒：reviewStatus=approved 且 validUntil 在 30/7 天内到期 */
  async checkAuthorizationExpiry(
    now: Date = new Date(),
  ): Promise<AuthorizationExpiryItem[]> {
    const threshold = new Date(
      now.getTime() + AUTHORIZATION_EXPIRY_WINDOW_DAYS * 24 * 3600 * 1000,
    );
    const rows = await this.prisma.showcaseAuthorization.findMany({
      where: {
        reviewStatus: 'approved',
        validUntil: { not: null, lte: threshold },
      },
      select: {
        id: true,
        caseId: true,
        recordType: true,
        grantor: true,
        licenseName: true,
        validUntil: true,
      },
    });

    return rows
      .map((row) => {
        const daysRemaining = daysUntil(row.validUntil, now);
        const window = expiryWindowOf(daysRemaining);
        return {
          id: row.id,
          caseId: row.caseId,
          recordType: row.recordType,
          grantor: row.grantor,
          licenseName: row.licenseName,
          validUntil: toIsoString(row.validUntil),
          daysRemaining,
          window,
        };
      })
      .filter(
        (item): item is AuthorizationExpiryItem => item.window !== null,
      );
  }

  /** 内容复核提醒：status=published 且 nextReviewAt 已过/7 天内到期 */
  async checkReviewDue(now: Date = new Date()): Promise<ReviewDueItem[]> {
    const threshold = new Date(
      now.getTime() + REVIEW_DUE_WINDOW_DAYS * 24 * 3600 * 1000,
    );
    const rows = await this.prisma.showcaseCase.findMany({
      where: {
        status: 'published',
        nextReviewAt: { not: null, lte: threshold },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        nextReviewAt: true,
        lastReviewedAt: true,
        ownerUserId: true,
      },
    });

    return rows.map((row) => {
      const daysRemaining = daysUntil(row.nextReviewAt, now);
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        status: row.status,
        nextReviewAt: row.nextReviewAt ? row.nextReviewAt.toISOString() : null,
        lastReviewedAt: row.lastReviewedAt
          ? row.lastReviewedAt.toISOString()
          : null,
        ownerUserId: row.ownerUserId,
        daysRemaining,
        overdue: daysRemaining < 0,
      };
    });
  }

  /** 演示入口健康度聚合 + 异常明细（复用 link-health-check 的探测结果） */
  async getDemoEndpointHealth(): Promise<{
    summary: DemoEndpointHealthSummary;
    anomalies: DemoEndpointAnomaly[];
  }> {
    const endpoints = await this.prisma.showcaseDemoEndpoint.findMany({
      where: { endpointType: { in: [...HEALTH_CHECK_ENDPOINT_TYPES] } },
      select: {
        id: true,
        caseId: true,
        endpointType: true,
        healthStatus: true,
        lastCheckedAt: true,
        ownerUserId: true,
        case: { select: { slug: true, title: true } },
      },
    });

    const summary: DemoEndpointHealthSummary = {
      total: endpoints.length,
      healthy: 0,
      warning: 0,
      broken: 0,
      expired: 0,
      unknown: 0,
    };
    const anomalies: DemoEndpointAnomaly[] = [];

    for (const endpoint of endpoints) {
      const status = endpoint.healthStatus ?? 'unknown';
      switch (status) {
        case 'healthy':
          summary.healthy += 1;
          break;
        case 'warning':
          summary.warning += 1;
          break;
        case 'broken':
          summary.broken += 1;
          break;
        case 'expired':
          summary.expired += 1;
          break;
        default:
          summary.unknown += 1;
          break;
      }

      if (status !== 'healthy') {
        anomalies.push({
          endpointId: endpoint.id,
          caseId: endpoint.caseId,
          caseSlug: endpoint.case.slug,
          caseTitle: endpoint.case.title,
          endpointType: endpoint.endpointType,
          healthStatus: status,
          lastCheckedAt: endpoint.lastCheckedAt
            ? endpoint.lastCheckedAt.toISOString()
            : null,
          ownerUserId: endpoint.ownerUserId,
        });
      }
    }

    return { summary, anomalies };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
