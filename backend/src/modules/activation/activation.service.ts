import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type ActivationEventType = 'first_publish' | 'first_lead';

/**
 * 激活事件（报告 16.3 第 1 项）：记录用户「首个价值」达成时刻，
 * 支撑 time_to_first_value 指标（注册 → 首个有效发布/线索）。
 * 幂等：同一用户同一事件类型只记一次（@@unique userId+eventType）。
 */
@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 记录首个价值（幂等）。已存在则静默跳过。失败旁路不抛异常。 */
  async recordFirstValue(input: {
    userId: string;
    tenantId?: string | null;
    eventType: ActivationEventType;
    refId?: string | null;
  }): Promise<{ recorded: boolean }> {
    try {
      await this.prisma.activationEvent.create({
        data: {
          userId: input.userId,
          tenantId: input.tenantId ?? null,
          eventType: input.eventType,
          refId: input.refId ?? null,
        },
      });
      return { recorded: true };
    } catch {
      // 唯一约束冲突 = 已记录过，静默忽略；其他错误旁路
      this.logger.debug(
        `activation 记录跳过: ${input.eventType} (${input.userId})`,
      );
      return { recorded: false };
    }
  }

  /** 查询激活状态 + 首个价值达成时间 + 注册到首价值耗时（分钟） */
  async getActivation(userId: string): Promise<{
    events: Array<{ eventType: string; createdAt: string }>;
    activated: boolean;
    timeToFirstValueMinutes: number | null;
  }> {
    const [events, user] = await Promise.all([
      this.prisma.activationEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      }),
    ]);
    const first = events[0] ?? null;
    const minutes =
      first && user?.createdAt
        ? Math.max(
            0,
            Math.round(
              (first.createdAt.getTime() - user.createdAt.getTime()) / 60000,
            ),
          )
        : null;
    return {
      events: events.map((e) => ({
        eventType: e.eventType,
        createdAt: e.createdAt.toISOString(),
      })),
      activated: events.length > 0,
      timeToFirstValueMinutes: minutes,
    };
  }
}
