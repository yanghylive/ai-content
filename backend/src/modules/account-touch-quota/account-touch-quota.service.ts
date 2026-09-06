import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 账号维度统一触达配额服务（3010 自动获客）
 *
 * 背景：growth 与 comment-acquisition 此前各自为政——growth 按「任务」记
 * exposureCount（同号开多任务会叠加穿透），comment-acquisition 干脆没有
 * 触达上限（只有熔断器）。本服务把「今天这个账号对外总共能碰几个目标」
 * 上提到账号维度统一计数，两套获客共用、同号累计扣减、扣完即停。
 *
 * 关键设计：
 * 1. 计数器 key = userId + platform + publishAccount.id（stableId）。
 * 2. 原子扣减：原生 SQL `UPDATE ... SET touch_count = touch_count + 1
 *    WHERE ... AND touch_count < daily_limit`，靠 affectedRows 判断是否扣成功，
 *    从根上杜绝「两个任务并发抢同一账号配额」导致的超发。
 * 3. 跨天自动切桶：touch_date 变化即换新桶，从 0 重新计。
 */
@Injectable()
export class AccountTouchQuotaService implements OnModuleInit {
  private readonly logger = new Logger(AccountTouchQuotaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 2026-09-06 发版门禁 R1 修复：account_touch_quotas 是业务表，走「模块懒建」。
   * schema.prisma 有 AccountTouchQuota model 但此前漏了启动建表，空库启动后
   * 缺表导致 R1 建表完整性失败、tryConsume 直接崩。此处启动时幂等建表。
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "account_touch_quotas" (
          "id" TEXT PRIMARY KEY NOT NULL,
          "user_id" TEXT NOT NULL,
          "platform" TEXT NOT NULL,
          "account_id" TEXT NOT NULL,
          "daily_limit" INTEGER NOT NULL DEFAULT 20,
          "touch_date" TEXT NOT NULL,
          "touch_count" INTEGER NOT NULL DEFAULT 0,
          "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "account_touch_quotas_user_id_platform_account_id_touch_date_key"
          ON "account_touch_quotas" ("user_id", "platform", "account_id", "touch_date")
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "account_touch_quotas_user_id_platform_account_id_idx"
          ON "account_touch_quotas" ("user_id", "platform", "account_id")
      `);
    } catch (error) {
      // 建表失败不阻断启动（非 SQLite/无权限等），业务访问时报错即可见
      this.logger.warn(
        `account_touch_quotas 建表失败（跳过）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 本地时区 YYYY-MM-DD */
  private today(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * 把调用方传入的 accountId（纯数字 id 或 stableId）解析为
   * publishAccount.id（stableId）作为配额 key。
   *
   * 复用 comment-acquisition 的账号解析语义：
   * - stableId 精确匹配（publish_accounts 主键，如 local-engine-xxx-6-douyin）
   * - 纯数字 id 按平台后缀匹配（auto-upload 数字 id）
   *
   * 解析失败（账号不存在/无权）抛 NotFoundException，由调用方决定是否拦。
   */
  async resolveStableId(
    accountId: number | string,
    scope: { tenantId: string | null; userId: string },
    platform?: string,
  ): Promise<string> {
    const id = String(accountId);
    const whereId = platform
      ? {
          OR: [{ id }, { id: { endsWith: `-${id}-${platform}` } }],
        }
      : { id };
    const account = await this.prisma.publishAccount.findFirst({
      where: {
        ...whereId,
        userId: scope.userId,
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      },
      select: { id: true },
    });
    if (!account) {
      throw new Error('发布账号不存在或无权操作');
    }
    return account.id;
  }

  /**
   * 尝试消费一次触达额度（原子、防超限）。
   *
   * @returns true = 扣减成功（允许真实触达）；false = 额度已用尽（应拦截）。
   *
   * 实现：先确保当天桶存在（INSERT ... ON CONFLICT DO NOTHING），再执行
   * 条件原子自增。affectedRows === 1 才表示「自增前 touch_count < daily_limit」，
   * 即本次消费成功。
   */
  async tryConsume(
    userId: string,
    platform: string,
    accountId: string,
    dailyLimit = 20,
  ): Promise<boolean> {
    const touchDate = this.today();
    await this.prisma.$executeRaw`
      INSERT INTO "account_touch_quotas"
        ("id", "user_id", "platform", "account_id", "daily_limit", "touch_date", "touch_count", "created_at", "updated_at")
      VALUES
        (${this.newId()}, ${userId}, ${platform}, ${accountId}, ${dailyLimit}, ${touchDate}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("user_id", "platform", "account_id", "touch_date") DO NOTHING
    `;

    // 条件自增：只有 touch_count < daily_limit 才 +1；affectedRows === 1 表示成功。
    const consumed = await this.prisma.$executeRaw`
      UPDATE "account_touch_quotas"
      SET "touch_count" = "touch_count" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "user_id" = ${userId}
        AND "platform" = ${platform}
        AND "account_id" = ${accountId}
        AND "touch_date" = ${touchDate}
        AND "touch_count" < "daily_limit"
    `;

    if (consumed === 1) {
      return true;
    }

    // 扣减失败：可能是额度用尽，也可能是桶不存在（理论不会，上面已确保）。
    this.logger.warn(
      `[account-touch-quota] ${platform}:${accountId} 今日触达额度已用尽或不可用`,
    );
    return false;
  }

  /**
   * 一次性扣减 n 次触达额度（原子、防超限）。用于 growth 触达完成后
   * 把「实际成功触达数」批量入账（逐 target 扣太碎，且触达是批量执行）。
   *
   * 语义：只有当 `touch_count + n <= daily_limit` 时才整体扣减；
   * 否则退回 0，返回本次实际可扣减的剩余额度（调用方据此决定是否重算）。
   *
   * @returns 实际成功入账的数量（0 表示额度不足以扣 n 条，或 n<=0）。
   */
  async tryConsumeN(
    userId: string,
    platform: string,
    accountId: string,
    n: number,
    dailyLimit = 20,
  ): Promise<number> {
    if (n <= 0) return 0;
    const touchDate = this.today();
    // 确保当天桶存在
    await this.prisma.$executeRaw`
      INSERT INTO "account_touch_quotas"
        ("id", "user_id", "platform", "account_id", "daily_limit", "touch_date", "touch_count", "created_at", "updated_at")
      VALUES
        (${this.newId()}, ${userId}, ${platform}, ${accountId}, ${dailyLimit}, ${touchDate}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("user_id", "platform", "account_id", "touch_date") DO NOTHING
    `;
    // 条件批量自增：touch_count + n <= daily_limit 才整体 +n。
    const consumed = await this.prisma.$executeRaw`
      UPDATE "account_touch_quotas"
      SET "touch_count" = "touch_count" + ${n},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "user_id" = ${userId}
        AND "platform" = ${platform}
        AND "account_id" = ${accountId}
        AND "touch_date" = ${touchDate}
        AND "touch_count" + ${n} <= "daily_limit"
    `;
    return consumed === 1 ? n : 0;
  }

  /** 查询某账号当天的触达进度（供前端/日志展示） */
  async getTodayUsage(
    userId: string,
    platform: string,
    accountId: string,
  ): Promise<{
    dailyLimit: number;
    touchCount: number;
    touchDate: string;
  } | null> {
    const touchDate = this.today();
    const row = await this.prisma.accountTouchQuota.findUnique({
      where: {
        userId_platform_accountId_touchDate: {
          userId,
          platform,
          accountId,
          touchDate,
        },
      },
    });
    if (!row) {
      return { dailyLimit: 20, touchCount: 0, touchDate };
    }
    return {
      dailyLimit: row.dailyLimit,
      touchCount: row.touchCount,
      touchDate: row.touchDate,
    };
  }

  /** 生成行主键（与 Prisma cuid 语义一致的随机 id；配额表无外键，用随机串即可） */
  private newId(): string {
    return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
