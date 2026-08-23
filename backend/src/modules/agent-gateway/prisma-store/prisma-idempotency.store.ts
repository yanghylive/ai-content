import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { makeError } from '../contracts/error-codes';

export interface IdempotencyRecordLike {
  tenantId: string;
  idempotencyKey: string;
  taskId: string;
  status: 'in_progress' | 'done';
  usageId?: string;
}

export type ClaimResult =
  | { status: 'new'; record: IdempotencyRecordLike }
  | { status: 'in_progress'; record: IdempotencyRecordLike }
  | { status: 'done'; record: IdempotencyRecordLike };

/**
 * 幂等仓储 DB 版：落 agent_gateway_tool_calls 表。
 * 与内存版 IdempotencyStore 方法形状一致（claim 抛 IDEMPOTENCY_CONFLICT 语义相同）；
 * 并发冲突由 DB 唯一约束 (tenantId, idempotencyKey) 兜底。
 */
@Injectable()
export class PrismaIdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async claim(
    tenantId: string,
    key: string,
    taskId: string,
    audit?: { userId?: string; toolName?: string; risk?: string; inputHash?: string },
  ): Promise<ClaimResult> {
    const existing = await this.prisma.agentGatewayToolCall.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
    });
    if (!existing) {
      try {
        await this.prisma.agentGatewayToolCall.create({
          data: {
            taskId,
            tenantId,
            userId: audit?.userId ?? '',
            toolName: audit?.toolName ?? '',
            risk: audit?.risk ?? 'low',
            inputHash: audit?.inputHash ?? '',
            status: 'running',
            idempotencyKey: key,
          },
        });
      } catch (e: unknown) {
        // 并发下唯一约束冲突 → 按进行中处理
        if ((e as { code?: string })?.code === 'P2002') {
          throw makeError('IDEMPOTENCY_CONFLICT', { details: { idempotencyKey: key, existingTaskId: taskId } });
        }
        throw e;
      }
      return { status: 'new', record: { tenantId, idempotencyKey: key, taskId, status: 'in_progress' } };
    }
    if (existing.status === 'running' || existing.status === 'scheduled') {
      throw makeError('IDEMPOTENCY_CONFLICT', { details: { idempotencyKey: key, existingTaskId: existing.taskId } });
    }
    return {
      status: 'done',
      record: { tenantId, idempotencyKey: key, taskId: existing.taskId, status: 'done', usageId: existing.usageId ?? undefined },
    };
  }

  async markDone(tenantId: string, key: string, usageId: string): Promise<void> {
    await this.prisma.agentGatewayToolCall.updateMany({
      where: { tenantId, idempotencyKey: key },
      data: { status: 'done', usageId },
    });
  }

  async release(tenantId: string, key: string): Promise<void> {
    await this.prisma.agentGatewayToolCall.deleteMany({
      where: { tenantId, idempotencyKey: key, status: 'running' },
    });
  }

  async get(tenantId: string, key: string): Promise<IdempotencyRecordLike | undefined> {
    const r = await this.prisma.agentGatewayToolCall.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
    });
    if (!r) return undefined;
    return {
      tenantId: r.tenantId,
      idempotencyKey: r.idempotencyKey,
      taskId: r.taskId,
      status: r.status === 'done' ? 'done' : 'in_progress',
      usageId: r.usageId ?? undefined,
    };
  }
}
