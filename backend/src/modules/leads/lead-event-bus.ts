import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 线索事件流（一期，轻量）。
 *
 * 一期只打通两个事件：lead.created（新线索）与 lead.converted（线索转客户）。
 * 供 CRM / 情报 / 互动等模块订阅，避免各模块直接互相调用产生耦合。
 *
 * 用 Node 原生 EventEmitter 实现，不引入 @nestjs/event-emitter 依赖。
 * S0-P1-11：emit 时先落 outbox 表（fire-and-forget），进程重启不丢失，
 * 供后续重放/补偿消费。
 */

export interface LeadCreatedEvent {
  type: 'lead.created';
  leadId: string;
  userId: string;
  tenantId: string | null;
  platform: string;
  sourceType: string;
  dedupeKey: string;
  at: Date;
}

export interface LeadConvertedEvent {
  type: 'lead.converted';
  leadId: string;
  customerId: string;
  userId: string;
  at: Date;
}

export type LeadEvent = LeadCreatedEvent | LeadConvertedEvent;

@Injectable()
export class LeadEventBus {
  private readonly emitter = new EventEmitter();

  constructor(private readonly prisma: PrismaService) {}

  emit(event: LeadEvent): void {
    // S0-P1-11：先落 outbox 表（fire-and-forget，失败不阻断主流程），
    // 进程重启不丢失，供后续重放/补偿消费。
    void this.prisma.leadEventOutbox
      .create({
        data: {
          eventType: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
    this.emitter.emit(event.type, event);
  }

  /** 查询未消费事件（供重放/补偿） */
  listPublished(limit = 100) {
    return this.prisma.leadEventOutbox.findMany({
      where: { status: 'published' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** 标记事件已消费 */
  async markConsumed(id: string): Promise<void> {
    await this.prisma.leadEventOutbox.update({
      where: { id },
      data: { status: 'consumed', consumedAt: new Date() },
    });
  }

  on(
    type: LeadEvent['type'],
    listener: (event: LeadEvent) => void,
  ): void {
    this.emitter.on(type, listener);
  }

  off(
    type: LeadEvent['type'],
    listener: (event: LeadEvent) => void,
  ): void {
    this.emitter.off(type, listener);
  }
}
