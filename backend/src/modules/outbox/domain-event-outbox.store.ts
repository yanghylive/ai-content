// 通用领域事件 outbox（开发文档 §13，统一开发计划 §九）
// 事件先落库再由 worker 发布；进程内 EventEmitter 只做进程内通知，不作事实总线。
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/** 领域事件类型（开发文档 §13.1，14 种） */
export const DOMAIN_EVENT_TYPES = [
  'source.content.discovered',
  'source.content.updated',
  'interaction.event.ingested',
  'identity.resolved',
  'lead.created',
  'lead.score.updated',
  'lead.duplicate.detected',
  'lead.suppressed',
  'lead.action.approval_requested',
  'lead.action.approved',
  'lead.action.executed',
  'lead.action.readback_verified',
  'lead.action.reconcile_required',
  'crm.timeline.appended',
  'crm.opportunity.stage_changed',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** 通用事件格式（开发文档 §13.2） */
export type DomainEvent<T = unknown> = {
  eventId: string;
  schemaVersion: number;
  tenantId: string;
  userId: string;
  aggregateType: string;
  aggregateId: string;
  type: DomainEventType | (string & {});
  idempotencyKey: string;
  occurredAt: string;
  payload: T;
};

@Injectable()
export class DomainEventOutboxStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 发布事件：先落 outbox（幂等：同 tenant+aggregate+idempotencyKey 只写一条），
   * 再由 worker 消费发布。进程内 EventEmitter 只做通知，不作事实总线。
   */
  async publish(event: DomainEvent): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.domainEventOutbox.findUnique({
      where: {
        tenantId_aggregateType_aggregateId_idempotencyKey: {
          tenantId: event.tenantId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          idempotencyKey: event.idempotencyKey,
        },
      },
    });
    if (existing) return { id: existing.id, created: false };

    const created = await this.prisma.domainEventOutbox.create({
      data: {
        eventId: event.eventId || randomUUID(),
        schemaVersion: event.schemaVersion ?? 1,
        tenantId: event.tenantId,
        userId: event.userId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        type: event.type,
        idempotencyKey: event.idempotencyKey,
        occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
        payload: event.payload as object,
      },
    });
    return { id: created.id, created: true };
  }

  /** 查待消费事件（按时间升序，供 worker 重放/补偿） */
  listPending(limit = 100) {
    return this.prisma.domainEventOutbox.findMany({
      where: { status: 'published' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** 标记已消费 */
  async markConsumed(id: string): Promise<void> {
    await this.prisma.domainEventOutbox.update({
      where: { id },
      data: { status: 'consumed', consumedAt: new Date() },
    });
  }

  /** 标记失败（可重试，指数退避由 worker 控制；超最大次数转 dead） */
  async markFailed(id: string, lastError: string, maxAttempt = 5): Promise<void> {
    const row = await this.prisma.domainEventOutbox.findUnique({ where: { id } });
    if (!row) return;
    const attempt = row.attempt + 1;
    await this.prisma.domainEventOutbox.update({
      where: { id },
      data: {
        attempt,
        lastError,
        status: attempt >= maxAttempt ? 'dead' : 'published',
      },
    });
  }
}
