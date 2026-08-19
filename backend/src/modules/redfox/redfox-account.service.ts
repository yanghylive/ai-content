import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RedfoxService, RedfoxActor } from './redfox.service';
import { RedfoxClientService } from './redfox-client.service';

const QUERY_USER_PATH = '/story/api/dyData/queryUser';
const QUERY_USER_SKILL = 'douyin-query-user';

export interface AccountHealth {
  accountId: string;
  name: string;
  avatarUrl?: string;
  signature?: string;
  followers: number;
  works: number;
  works30d: number;
  totalFavorited: number;
  // 本地健康打分（A/B/C/D + 建议）
  grade: 'A' | 'B' | 'C' | 'D';
  score: number; // 0-100
  suggestions: string[];
  snapshot: Record<string, unknown>;
}

export interface SubscriptionDelta {
  accountId: string;
  name: string;
  followersDelta: number;
  worksDelta: number;
  newWorks: number;
}

interface QueryUserResult {
  code: number;
  data?: Record<string, unknown>;
  msg?: string;
}

/**
 * 账号诊断 + 竞品订阅（A6/M5，主文档 P2）
 *
 * 诊断：RedFox dyData/queryUser（douyin-query-user）拿账号数据 → 本地健康打分（A-D + 建议）
 * 订阅：AccountSubscription 表持久化；cron 每日抓取 → 与上次快照对比 → 变化记录
 * 降级：queryUser 失败返回空态/保留上次快照，不阻塞。
 */
@Injectable()
export class RedfoxAccountService {
  private readonly logger = new Logger(RedfoxAccountService.name);

  constructor(
    private readonly redfoxService: RedfoxService,
    private readonly client: RedfoxClientService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 账号诊断（M5）：url 或 accountId → queryUser → 健康打分
   */
  async diagnose(
    actor: RedfoxActor,
    input: { accountUrl?: string; accountId?: string; accountName?: string },
  ): Promise<AccountHealth> {
    const url = (input.accountUrl || '').trim();
    const accountId = (input.accountId || '').trim();
    if (!url && !accountId) {
      throw new BadRequestException('请提供账号链接或账号 ID');
    }

    const scope = await this.redfoxService.resolveScope(actor);
    const connection = await this.redfoxService.getEffectiveConnection(scope);
    const raw = await this.client.request<QueryUserResult>(scope, connection, {
      method: 'POST',
      path: QUERY_USER_PATH,
      body: url ? { accountUrl: url } : { accountId },
      operation: `redfox.skill.execute.account-diagnose.${url ? 'url' : 'id'}`,
      skillCode: QUERY_USER_SKILL,
      estimatedCostPoints: 1,
    });

    const data = raw?.data ?? {};
    const name = this.toText(
      data.nickname,
      data.name,
      input.accountName,
    ).trim();
    const resolvedId =
      this.toText(data.accountId, data.uid, data.secUid).trim() || accountId;
    if (!name && !resolvedId) {
      this.logger.warn('账号诊断：queryUser 未返回有效账号数据');
      throw new BadRequestException(
        '未找到该账号（可能是链接格式或平台不支持）',
      );
    }

    const followers = this.toNumber(
      data.followerCount,
      data.fans,
      data.fansCount,
    );
    const works = this.toNumber(data.awemeCount, data.workCount, data.works);
    const works30d = this.toNumber(data.awemeCountThirty, data.aweme30d);
    const totalFavorited = this.toNumber(
      data.totalFavorited,
      data.favorited,
      data.likes,
    );
    const snapshot: Record<string, unknown> = {
      followers,
      works,
      works30d,
      totalFavorited,
      signature: this.toText(data.signature) || undefined,
      updatedAt: new Date().toISOString(),
    };

    return {
      accountId: resolvedId,
      name: name || resolvedId,
      avatarUrl: this.toText(data.avatarUrl) || undefined,
      signature: this.toText(data.signature) || undefined,
      followers,
      works,
      works30d,
      totalFavorited,
      ...this.grade(followers, works, works30d),
      snapshot,
    };
  }

  /** 订阅竞品账号（upsert） */
  async subscribe(
    actor: RedfoxActor,
    input: { accountUrl?: string; accountId?: string; platform?: string },
  ): Promise<{ id: string; accountId: string; accountName: string }> {
    const url = (input.accountUrl || '').trim();
    if (!url && !(input.accountId || '').trim()) {
      throw new BadRequestException('请提供账号链接或账号 ID');
    }
    const health = await this.diagnose(actor, {
      accountUrl: url || undefined,
      accountId: (input.accountId || '').trim() || undefined,
    });
    const { userId, tenantId } = this.resolveUser(actor);

    const row = await this.prisma.accountSubscription.upsert({
      where: {
        userId_platform_accountId: {
          userId,
          platform: input.platform || 'douyin',
          accountId: health.accountId,
        },
      },
      create: {
        tenantId,
        userId,
        platform: input.platform || 'douyin',
        accountId: health.accountId,
        accountName: health.name,
        accountUrl: url,
        active: true,
        lastFetchedAt: new Date(),
        lastSnapshot: health.snapshot as Prisma.InputJsonValue,
      },
      update: {
        accountName: health.name,
        accountUrl: url,
        active: true,
        lastFetchedAt: new Date(),
        lastSnapshot: health.snapshot as Prisma.InputJsonValue,
      },
    });
    this.logger.log(`竞品订阅新增/更新：${health.name}（${row.id}）`);
    return {
      id: row.id,
      accountId: health.accountId,
      accountName: health.name,
    };
  }

  /** 我的订阅列表 */
  async listSubscriptions(actor: RedfoxActor) {
    const { userId } = this.resolveUser(actor);
    try {
      return await this.prisma.accountSubscription.findMany({
        where: { userId, active: true },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('account_subscriptions') ||
        message.includes('AccountSubscription')
      ) {
        this.logger.warn(
          '竞品订阅表尚未初始化，已按空列表返回，避免账号健康页出现 500。',
        );
        return [];
      }
      throw error;
    }
  }

  /** 取消订阅 */
  async unsubscribe(actor: RedfoxActor, id: string) {
    const { userId } = this.resolveUser(actor);
    const row = await this.prisma.accountSubscription.findFirst({
      where: { id, userId },
    });
    if (!row) throw new NotFoundException('订阅不存在');
    await this.prisma.accountSubscription.update({
      where: { id },
      data: { active: false },
    });
    this.logger.log(`竞品订阅取消：${row.accountName}（${id}）`);
    return { ok: true };
  }

  /**
   * 账号体检 30 天报告（F7）：聚合历史快照趋势
   * 按账号返回最近 N 天快照序列 + 风险/失败率变化 + 最新建议
   */
  async healthReport(
    actor: RedfoxActor,
    input: { accountId?: string; days?: number },
  ): Promise<{
    accounts: Array<{
      accountId: string;
      accountName: string;
      platform: string;
      snapshotCount: number;
      from: string;
      to: string;
      latestRisk: string;
      initialRisk: string;
      riskStable: boolean;
      latestFailureRate: number;
      initialFailureRate: number;
      trend: Array<{
        checkedAt: string;
        failureRate: number;
        riskStatus: string;
      }>;
      recommendation: string;
    }>;
  }> {
    const { userId } = this.resolveUser(actor);
    const days = Math.min(90, Math.max(1, Math.round(input.days || 30)));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const where: Record<string, unknown> = {
      userId,
      checkedAt: { gte: since },
    };
    if (input.accountId) where.accountId = input.accountId;

    let snapshots: Awaited<
      ReturnType<typeof this.prisma.growthAccountHealthSnapshot.findMany>
    >;
    try {
      snapshots = await this.prisma.growthAccountHealthSnapshot.findMany({
        where,
        orderBy: { checkedAt: 'asc' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('growth_account_health_snapshots') ||
        message.includes('GrowthAccountHealthSnapshot')
      ) {
        this.logger.warn(
          '账号健康快照表尚未初始化，已按空报告返回，避免账号健康页出现 500。',
        );
        return { accounts: [] };
      }
      throw error;
    }

    const byAccount = new Map<string, (typeof snapshots)[number][]>();
    for (const s of snapshots) {
      const key = `${s.platform}:${s.accountId}`;
      const list = byAccount.get(key) ?? [];
      list.push(s);
      byAccount.set(key, list);
    }

    const accounts = [...byAccount.entries()].map(([_key, list]) => {
      const first = list[0];
      const last = list[list.length - 1];
      return {
        accountId: last.accountId,
        accountName: last.accountName,
        platform: last.platform,
        snapshotCount: list.length,
        from: first.checkedAt.toISOString(),
        to: last.checkedAt.toISOString(),
        latestRisk: last.riskStatus,
        initialRisk: first.riskStatus,
        riskStable: first.riskStatus === last.riskStatus,
        latestFailureRate: last.failureRate,
        initialFailureRate: first.failureRate,
        trend: list.map((s) => ({
          checkedAt: s.checkedAt.toISOString(),
          failureRate: s.failureRate,
          riskStatus: s.riskStatus,
        })),
        recommendation: last.recommendation,
      };
    });

    return { accounts };
  }

  /**
   * cron 每日抓取所有订阅 → 与上次快照对比 → 记录变化
   * 每天 09:15 跑（避开发布高峰，错峰省积分）
   */
  @Cron('15 9 * * *')
  async dailyFetchSubscriptions() {
    const subs = await this.prisma.accountSubscription.findMany({
      where: { active: true },
    });
    if (subs.length === 0) return;
    this.logger.log(`每日竞品抓取开始：${subs.length} 个订阅`);
    const deltas: SubscriptionDelta[] = [];
    for (const sub of subs) {
      try {
        const scope = await this.redfoxService.resolveScope({
          id: sub.userId,
          kaypalUserId: sub.userId,
          kaypalRole: 'user',
          role: 'user',
        });
        const connection =
          await this.redfoxService.getEffectiveConnection(scope);
        const raw = await this.client.request<QueryUserResult>(
          scope,
          connection,
          {
            method: 'POST',
            path: QUERY_USER_PATH,
            body: { accountId: sub.accountId },
            operation: `redfox.skill.execute.subscription-fetch.${sub.accountId}`,
            skillCode: QUERY_USER_SKILL,
            estimatedCostPoints: 1,
          },
        );
        const data = raw?.data ?? {};
        const snapshot = {
          followers: this.toNumber(
            data.followerCount,
            data.fans,
            data.fansCount,
          ),
          works: this.toNumber(data.awemeCount, data.workCount, data.works),
          works30d: this.toNumber(data.awemeCountThirty, data.aweme30d),
          totalFavorited: this.toNumber(data.totalFavorited, data.favorited),
          updatedAt: new Date().toISOString(),
        };
        const prev = (sub.lastSnapshot ?? {}) as Record<string, unknown>;
        const followersDelta =
          (snapshot.followers ?? 0) - this.toNumber(prev.followers);
        const worksDelta = (snapshot.works ?? 0) - this.toNumber(prev.works);
        if (followersDelta !== 0 || worksDelta !== 0) {
          deltas.push({
            accountId: sub.accountId,
            name: sub.accountName || sub.accountId,
            followersDelta,
            worksDelta,
            newWorks: Math.max(worksDelta, 0),
          });
        }
        await this.prisma.accountSubscription.update({
          where: { id: sub.id },
          data: { lastFetchedAt: new Date(), lastSnapshot: snapshot },
        });
      } catch (error) {
        this.logger.warn(
          `订阅抓取失败（跳过）：${sub.accountName} ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (deltas.length > 0) {
      this.logger.log(
        `竞品变化：${deltas.map((d) => `${d.name} 粉丝${d.followersDelta >= 0 ? '+' : ''}${d.followersDelta}/作品${d.worksDelta >= 0 ? '+' : ''}${d.worksDelta}`).join('；')}`,
      );
    }
  }

  // ---------- 内部 ----------

  /** 本地健康打分：粉丝量/作品量/近30天活跃 → A-D + 建议 */
  private grade(
    followers: number,
    works: number,
    works30d: number,
  ): { grade: 'A' | 'B' | 'C' | 'D'; score: number; suggestions: string[] } {
    const suggestions: string[] = [];
    let score = 0;
    if (followers >= 500000) score += 40;
    else if (followers >= 100000) score += 30;
    else if (followers >= 10000) score += 20;
    else if (followers >= 1000) score += 10;
    else suggestions.push('粉丝量较低（<1k），建议先用爆款拆解找可复制的选题');
    if (works >= 300) score += 20;
    else if (works >= 100) score += 15;
    else if (works >= 30) score += 10;
    else suggestions.push('作品数偏少（<30），内容产出频率不足');
    if (works30d >= 10) score += 30;
    else if (works30d >= 3) score += 20;
    else if (works30d >= 1) score += 10;
    else suggestions.push('近 30 天几乎未更新，活跃度低');
    if (score >= 80) suggestions.push('头部账号：可重点研究其选题与封面套路');
    else if (score >= 50)
      suggestions.push('腰部账号：增长中，适合跟踪其爆款规律');
    else suggestions.push('可当作反向案例，观察其增长瓶颈');
    const grade: 'A' | 'B' | 'C' | 'D' =
      score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
    return { grade, score, suggestions };
  }

  private resolveUser(actor: RedfoxActor): {
    userId: string;
    tenantId?: string;
  } {
    const userId = actor?.id?.trim();
    if (!userId) throw new BadRequestException('请先登录');
    return { userId, tenantId: undefined };
  }

  private toText(...values: unknown[]): string {
    for (const v of values) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return JSON.stringify(v);
    }
    return '';
  }

  private toNumber(...values: unknown[]): number {
    for (const v of values) {
      if (v === null || v === undefined) continue;
      const n =
        typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : Number(v);
      if (!Number.isNaN(n) && Number.isFinite(n)) return Math.max(0, n);
    }
    return 0;
  }
}
