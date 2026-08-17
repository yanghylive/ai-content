// 采集配额服务（报告 16.3 第 6 项，2026-08-17）
// 发现中心每日采集次数上限：keyword/target-account 浏览器会话发现计数，
// 超限抛 quota_exceeded 原因码（不静默降级）。默认 100 次/日，env ACQUISITION_DAILY_LIMIT 覆盖。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class AcquisitionQuotaExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly used: number,
  ) {
    super(`今日采集配额已用完（${used}/${limit}），明天再试或调整 ACQUISITION_DAILY_LIMIT`);
    this.name = 'AcquisitionQuotaExceededError';
  }
}

export interface AcquisitionQuotaView {
  date: string;
  used: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}

function dailyLimit(): number {
  const raw = Number(process.env.ACQUISITION_DAILY_LIMIT || '100');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

@Injectable()
export class AcquisitionQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private today(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** 今日配额视图 */
  async getQuota(userId: string): Promise<AcquisitionQuotaView> {
    const row = await this.prisma.acquisitionQuota.findUnique({
      where: { userId_date: { userId, date: this.today() } },
    });
    const limit = dailyLimit();
    const used = row?.discoverCount ?? 0;
    return {
      date: this.today().toISOString().slice(0, 10),
      used,
      limit,
      remaining: Math.max(limit - used, 0),
      exceeded: used >= limit,
    };
  }

  /** 采集前检查：超限抛 quota_exceeded（结构化原因码） */
  async assertCanDiscover(userId: string): Promise<void> {
    const quota = await this.getQuota(userId);
    if (quota.exceeded) {
      throw new AcquisitionQuotaExceededError(quota.limit, quota.used);
    }
  }

  /** 发现一次 +1（幂等 upsert 日行） */
  async recordDiscover(userId: string): Promise<void> {
    await this.prisma.acquisitionQuota.upsert({
      where: { userId_date: { userId, date: this.today() } },
      create: { userId, date: this.today(), discoverCount: 1 },
      update: { discoverCount: { increment: 1 }, updatedAt: new Date() },
    });
  }

  /** 计数 + 检查合并（防并发超限：先检查后计数，允许临界窗口） */
  async consumeDiscover(userId: string): Promise<void> {
    await this.assertCanDiscover(userId);
    await this.recordDiscover(userId);
  }
}
