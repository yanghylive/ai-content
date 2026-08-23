import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { OutboxDbLike, OutboxRecord } from '../core/memory-orchestrator';

/**
 * outbox DB 仓储（agent_gateway_memory_outbox）：
 * - upsert：capture/flush/删除作废时镜像状态（含 content/itemId，重启可重放）
 * - loadPending：恢复 pending/dead 供 hydrateOutbox（worker 重启续跑）
 */
@Injectable()
export class PrismaOutboxStore implements OutboxDbLike {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(record: OutboxRecord): Promise<void> {
    await this.prisma.agentGatewayMemoryOutbox.upsert({
      where: { memoryEventId: record.memoryEventId },
      create: {
        memoryEventId: record.memoryEventId,
        tenantId: record.tenantId,
        userId: record.userId,
        agentId: record.agentId,
        scope: record.scope,
        namespace: record.namespace,
        content: record.content,
        itemId: record.itemId,
        operation: record.operation,
        payloadHash: record.payloadHash,
        attempts: record.attempts,
        nextRetryAt: new Date(record.nextRetryAt),
        status: record.status,
      },
      update: {
        attempts: record.attempts,
        nextRetryAt: new Date(record.nextRetryAt),
        status: record.status,
        content: record.content,
        itemId: record.itemId,
      },
    });
  }

  async loadPending(): Promise<Array<OutboxRecord & { source?: string }>> {
    const rows = await this.prisma.agentGatewayMemoryOutbox.findMany({
      where: { status: { in: ['pending', 'dead'] } },
    });
    return rows.map((r) => ({
      memoryEventId: r.memoryEventId,
      tenantId: r.tenantId,
      userId: r.userId,
      agentId: r.agentId,
      scope: r.scope,
      namespace: r.namespace,
      content: r.content ?? '',
      itemId: r.itemId ?? '',
      operation: r.operation as 'add' | 'delete',
      payloadHash: r.payloadHash,
      attempts: r.attempts,
      nextRetryAt: r.nextRetryAt.toISOString(),
      status: r.status as 'pending' | 'dead' | 'done',
    }));
  }
}
