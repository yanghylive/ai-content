import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RedfoxService } from '../redfox/redfox.service';
import {
  RedfoxHotTopicsService,
  type HotTopicItem,
} from '../redfox/redfox-hot-topics.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * F1 定时日报：每天 08:00 为近 7 天活跃用户自动生成「今日热点日报」
 * - 热点数据走 RedfoxHotTopicsService（30 分钟缓存：白天用户浏览过首页即命中，不额外消耗）
 * - 幂等：当天已生成过 daily 的用户跳过
 * - 单用户失败隔离，不影响其他用户
 */
@Injectable()
export class IntelligenceDailyReportCronService {
  private readonly logger = new Logger(IntelligenceDailyReportCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hotTopics: RedfoxHotTopicsService,
    private readonly redfoxService: RedfoxService,
  ) {}

  @Cron('0 8 * * *')
  async generateDailyReports(): Promise<void> {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    // 近 7 天活跃用户（有登录行为才生成，避免给休眠账号发日报）
    const users = await this.prisma.user.findMany({
      where: { lastLoginAt: { gte: since } },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        status: true,
        lastLoginAt: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        kaypalUserId: true,
      },
    });
    if (users.length === 0) {
      this.logger.log('今日无活跃用户，跳过日报生成');
      return;
    }

    // 幂等：当天已有 daily 报告的用户跳过
    const existing = await this.prisma.intelligenceReport.findMany({
      where: { kind: 'daily', createdAt: { gte: todayStart } },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((r) => r.userId));

    let created = 0;
    let skipped = 0;
    for (const user of users) {
      if (existingIds.has(user.id)) {
        skipped += 1;
        continue;
      }
      try {
        const scope = await this.redfoxService.resolveScope({
          id: user.id,
          kaypalUserId: user.kaypalUserId ?? null,
          role: user.role,
        });
        const authUser = this.toAuthUser(user);
        const hot = await this.hotTopics.getHotTopics(authUser);
        if (!hot.items.length) {
          this.logger.warn(
            `用户 ${user.id}（${user.name || user.username}）无热点数据，跳过`,
          );
          skipped += 1;
          continue;
        }
        const markdown = this.buildDailyMarkdown(hot.items);
        await this.prisma.intelligenceReport.create({
          data: {
            userId: user.id,
            tenantId: scope.tenantId ?? null,
            kind: 'daily',
            title: this.dailyTitle(now),
            markdown,
            status: 'completed',
            completeness: 100,
          },
        });
        created += 1;
      } catch (err: unknown) {
        this.logger.error(
          `用户 ${user.id} 日报生成失败：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.logger.log(
      `定时日报完成：新增 ${created} 份，跳过 ${skipped}（今日已有/无热点）`,
    );
  }

  private dailyTitle(now: Date): string {
    return `今日热点日报（${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}）`;
  }

  /** 复刻前端 report-generator 的 buildDailyMarkdown（保持手动/定时产物格式一致） */
  private buildDailyMarkdown(items: HotTopicItem[]): string {
    const now = new Date();
    const dateLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const byPlatform = new Map<string, HotTopicItem[]>();
    for (const item of items) {
      const key = item.platform || '其他';
      const list = byPlatform.get(key) ?? [];
      list.push(item);
      byPlatform.set(key, list);
    }
    const platformLines = [...byPlatform.entries()]
      .map(
        ([platform, list]) =>
          `### ${platform}（${list.length} 条）\n${list
            .map(
              (item, i) =>
                `${i + 1}. **${item.title}**${item.heat ? `（热度 ${item.heat}）` : ''}${item.url ? ` [原文](${item.url})` : ''}`,
            )
            .join('\n')}`,
      )
      .join('\n\n');
    return [
      `# 今日热点日报（${dateLabel}）`,
      ``,
      `> 数据来源：RedFox 全网热点聚合（30 分钟缓存）｜生成时间 ${now.toLocaleTimeString('zh-CN')}`,
      ``,
      `## 总览`,
      `- 今日聚合热点 **${items.length} 条**，覆盖 ${byPlatform.size} 个平台`,
      `- 高热度选题建议优先跟进：${items
        .filter((i) => i.heat)
        .slice(0, 3)
        .map((i) => `「${i.title}」`)
        .join('、') || '按平台分布挑选切入'} `,
      ``,
      platformLines,
      ``,
      `---`,
      `*日报由 JIUZHANG AI 自动生成，用于选题灵感参考。*`,
    ].join('\n');
  }

  /** User 记录 → AuthenticatedUser（定时任务无真实登录会话，构造最小可用上下文） */
  private toAuthUser(user: {
    id: string;
    username: string;
    email: string;
    name: string;
    status: string;
    lastLoginAt: Date | null;
    role: string;
    createdAt: Date;
    updatedAt: Date;
    kaypalUserId?: string | null;
  }): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      kaypalUserId: user.kaypalUserId ?? null,
      role: user.role,
      commercialExecutionAllowed: false,
      planMode: 'trial',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
