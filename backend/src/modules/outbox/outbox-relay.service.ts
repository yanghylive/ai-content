// Outbox Relay Worker（P1-8，2026-08-17）
// 定时消费 domain_event_outbox + lead_event_outbox 的 published 事件：
//   发布到进程内 EventEmitter（订阅者接收），成功 markConsumed，失败 markFailed（可重试）。
// 解决「事件静默丢失、无消费者」问题——事件链不再只有写入没有消费。
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/** 领域事件（relay 广播给订阅者的完整事件） */
export interface OutboxDomainEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  userId: string;
  payload: unknown;
}

@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  /** 进程内事件总线（订阅者用 onDomainEvent 订阅） */
  readonly events = new EventEmitter();

  private running = false;
  /** 按 type 关注的 listener 计数（onDomainEvent 声明 types 时登记，用于精确判断某 type 是否有消费者） */
  private readonly typedListenerCount = new Map<string, number>();
  /** 未声明 types 的 listener 数（关注所有 type） */
  private wildcardListenerCount = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy() {
    this.events.removeAllListeners();
    this.typedListenerCount.clear();
    this.wildcardListenerCount = 0;
  }

  /** 订阅领域事件（供评分/CRM/复盘等模块注册 handler；支持 async，成功才 markConsumed）。
   * 可选 types 声明关注的领域事件类型；未声明则关注所有类型。 */
  onDomainEvent(
    handler: (event: OutboxDomainEvent) => void | Promise<void>,
    types?: string[],
  ): void {
    const interestedTypes = (types ?? []).filter((t) => t.length > 0);
    if (interestedTypes.length > 0) {
      for (const type of interestedTypes) {
        this.typedListenerCount.set(
          type,
          (this.typedListenerCount.get(type) ?? 0) + 1,
        );
      }
    } else {
      this.wildcardListenerCount += 1;
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- 有意返回 Promise 供 emitAndAwait await（成功才 markConsumed）
    this.events.on('domain-event', (event: OutboxDomainEvent) => {
      if (interestedTypes.length > 0 && !interestedTypes.includes(event.type)) {
        return;
      }
      // 返回 handler 的 Promise（而非 void 掉），让 emitAndAwait 真正等待异步消费者完成，
      // 成功才 markConsumed，失败抛错触发重试。
      return handler(event);
    });
  }

  /** 某领域事件类型当前是否有消费者（未声明 types 的通配 listener 视为关注所有 type） */
  private hasListenerFor(type: string): boolean {
    return (
      this.wildcardListenerCount > 0 ||
      (this.typedListenerCount.get(type) ?? 0) > 0
    );
  }

  /** 每 30s 消费一批 outbox 事件 */
  @Cron('*/30 * * * * *')
  async relayPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.relayDomainEvents();
    } catch (error) {
      this.logger.warn(`outbox relay 批次失败：${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async relayDomainEvents(): Promise<void> {
    const rows = await this.prisma.domainEventOutbox.findMany({
      where: { status: 'published' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const row of rows) {
      if (!this.hasListenerFor(row.type)) {
        // 该 type 无消费者时不标记 consumed，事件保留 published 等待消费者接入，避免静默丢失。
        this.logger.warn(
          `domain outbox 无消费者，事件 ${row.id}（${row.type}）保留 published`,
        );
        continue;
      }
      try {
        // 等待所有 listener（含 async）完成，全部成功才 markConsumed
        await this.emitAndAwait('domain-event', {
          type: row.type,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          tenantId: row.tenantId,
          userId: row.userId,
          payload: row.payload,
        });
        await this.prisma.domainEventOutbox.update({
          where: { id: row.id },
          data: { status: 'consumed', consumedAt: new Date() },
        });
      } catch (error) {
        const attempt = row.attempt + 1;
        await this.prisma.domainEventOutbox.update({
          where: { id: row.id },
          data: {
            attempt,
            lastError: (error as Error).message.slice(0, 500),
            status: attempt >= 5 ? 'dead' : 'published',
          },
        });
      }
    }
  }

  /** 等待所有（含 async）listener 完成；任一失败则整批抛错，不 markConsumed。 */
  private async emitAndAwait(
    eventName: string,
    payload: unknown,
  ): Promise<void> {
    const listeners = this.events.listeners(eventName) as Array<
      (event: unknown) => unknown
    >;
    await Promise.all(
      listeners.map((listener) => Promise.resolve(listener(payload))),
    );
  }

  /**
   * 补偿扫描（每 5 分钟）：CRM 已转换但缺 convert_crm outbox 事件的线索，按幂等键补写。
   * 兜底 lead-convert 事务提交后写 outbox 失败的场景（「CRM 已转换但欢迎语等异步事件缺失」）。
   * 判据：lead.status='converted' 且无对应 convert-crm:leadId 的 outbox 事件（幂等键精确匹配，不误扫 contacted）。
   */
  @Cron('0 */5 * * * *')
  async compensateMissingConvertEvents(): Promise<void> {
    const leads = await this.prisma.lead.findMany({
      where: { status: 'converted' },
      select: { id: true, userId: true, tenantId: true, customerId: true },
    });
    let compensated = 0;
    for (const lead of leads) {
      if (!lead.customerId) continue;
      const outboxKey = `convert-crm:${lead.id}`;
      // 判据按 aggregateId + type 查（不按 idempotencyKey）：controller 调用方可能传自定义
      // idempotencyKey（lead-convert 的 outboxKey = idempotencyKey ?? convert-crm:leadId），
      // 按固定 key 查会漏判 → 误补重复事件（重复欢迎语）。
      const existing = await this.prisma.domainEventOutbox.findFirst({
        where: {
          aggregateType: 'lead',
          aggregateId: lead.id,
          type: 'lead.action.executed',
        },
        select: { id: true },
      });
      if (existing) continue;
      try {
        await this.prisma.domainEventOutbox.create({
          data: {
            eventId: createHash('sha1').update(outboxKey).digest('hex'),
            schemaVersion: 1,
            tenantId: lead.tenantId ?? 'legacy-local-desktop',
            userId: lead.userId,
            aggregateType: 'lead',
            aggregateId: lead.id,
            type: 'lead.action.executed',
            idempotencyKey: outboxKey,
            occurredAt: new Date(),
            payload: {
              actionType: 'convert_crm',
              leadId: lead.id,
              customerId: lead.customerId,
            },
            status: 'published',
          },
        });
        compensated += 1;
      } catch (error) {
        // P2002 幂等冲突：并发已补，忽略；其它错误记日志下轮重试
        if ((error as { code?: string }).code !== 'P2002') {
          this.logger.warn(
            `CRM outbox 补偿补写失败（lead=${lead.id}）：${(error as Error).message}`,
          );
        }
      }
    }
    if (compensated > 0) {
      this.logger.log(
        `CRM outbox 补偿：补写 ${compensated} 条缺失的 convert_crm 事件`,
      );
    }
  }
}
