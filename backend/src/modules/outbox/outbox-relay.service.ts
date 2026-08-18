// Outbox Relay Worker（P1-8，2026-08-17）
// 定时消费 domain_event_outbox + lead_event_outbox 的 published 事件：
//   发布到进程内 EventEmitter（订阅者接收），成功 markConsumed，失败 markFailed（可重试）。
// 解决「事件静默丢失、无消费者」问题——事件链不再只有写入没有消费。
import { EventEmitter } from 'node:events';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  /** 进程内事件总线（订阅者用 onDomainEvent 订阅） */
  readonly events = new EventEmitter();

  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy() {
    this.events.removeAllListeners();
  }

  /** 订阅领域事件（供评分/CRM/复盘等模块注册 handler） */
  onDomainEvent(handler: (event: { type: string; aggregateType: string; payload: unknown }) => void): void {
    this.events.on('domain-event', handler);
  }

  /** 每 30s 消费一批 outbox 事件 */
  @Cron('*/30 * * * * *')
  async relayPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.relayDomainEvents();
      await this.relayLeadEvents();
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
      try {
        this.events.emit('domain-event', {
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

  private async relayLeadEvents(): Promise<void> {
    const rows = await this.prisma.leadEventOutbox.findMany({
      where: { status: 'published' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const row of rows) {
      try {
        this.events.emit('domain-event', {
          type: row.eventType,
          aggregateType: 'lead',
          aggregateId: (row.payload as Record<string, unknown>).leadId,
          payload: row.payload,
        });
        await this.prisma.leadEventOutbox.update({
          where: { id: row.id },
          data: { status: 'consumed', consumedAt: new Date() },
        });
      } catch (error) {
        this.logger.warn(`lead outbox ${row.id} 消费失败：${(error as Error).message}`);
      }
    }
  }
}
