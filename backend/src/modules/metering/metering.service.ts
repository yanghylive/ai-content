import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 用量计量（阶段 B，报告 16.5 预占-确认-冲正）。
 * 每次计量动作走三态：reserved（预占）→ confirmed（确认）/ reversed（冲正）。
 * 幂等：同一 idempotencyKey 只预占一次，防重复扣费/重复计数。
 */
@Injectable()
export class MeteringService {
  private readonly logger = new Logger(MeteringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 预占：执行前占一笔用量。幂等（同 idempotencyKey 只占一次）。 */
  async reserve(input: {
    userId?: string | null;
    tenantId?: string | null;
    meter: string;
    amount: number;
    context?: string;
    refId?: string;
    idempotencyKey?: string;
  }): Promise<{ id: string }> {
    if (input.idempotencyKey) {
      const existing = await this.prisma.usageEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { id: existing.id };
    }
    const event = await this.prisma.usageEvent.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        meter: input.meter,
        amount: input.amount,
        state: 'reserved',
        context: input.context ?? null,
        refId: input.refId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    return { id: event.id };
  }

  /** 确认：执行成功，预占转已确认（计入用量）。 */
  async confirm(eventId: string): Promise<void> {
    await this.prisma.usageEvent.update({
      where: { id: eventId },
      data: { state: 'confirmed' },
    });
  }

  /** 冲正：执行失败，预占退回（转 reversed，不再计入用量）。 */
  async reverse(eventId: string): Promise<void> {
    await this.prisma.usageEvent.update({
      where: { id: eventId },
      data: { state: 'reversed' },
    });
  }

  /** 查询某用户某计量维度的「已确认」用量总和。 */
  async confirmedUsage(
    userId: string,
    meter: string,
    since?: Date,
  ): Promise<number> {
    const agg = await this.prisma.usageEvent.aggregate({
      where: {
        userId,
        meter,
        state: 'confirmed',
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }
}
