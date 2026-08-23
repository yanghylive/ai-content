import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UsageEvent } from '../core/types';

/**
 * usage 持久化 sink：落 agent_gateway_usage_events（计费对账副本）。
 * 引擎内存态仍是权威；DB 为对账锚点（usageId 唯一，与 Kaypal 回执可对账）。
 */
@Injectable()
export class PrismaUsageSink {
  constructor(private readonly prisma: PrismaService) {}

  async record(ev: UsageEvent): Promise<void> {
    const data = {
      requestId: ev.requestId,
      tenantId: ev.tenantId,
      taskId: ev.taskId ?? null,
      toolCallId: ev.toolCallId ?? null,
      model: ev.model ?? null,
      inputTokens: ev.inputTokens,
      outputTokens: ev.outputTokens,
      computeUnits: ev.computeUnits,
      cost: ev.cost ?? null,
      status: ev.status,
      createdAt: new Date(ev.createdAt),
    };
    await this.prisma.agentGatewayUsageEvent.upsert({
      where: { usageId: ev.usageId },
      create: { usageId: ev.usageId, ...data },
      update: {
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
        computeUnits: ev.computeUnits,
        cost: ev.cost ?? null,
        status: ev.status,
      },
    });
  }
}
