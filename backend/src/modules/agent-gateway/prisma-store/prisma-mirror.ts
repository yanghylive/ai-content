import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AgentGatewayMirror } from '../core/mirror';
import { AgentSession, AgentTask, AgentEvent, Artifact } from '../core/types';

/**
 * 写路径持久化镜像（agent_gateway_* 表）：
 * 引擎内存态仍权威；每次 session/task/event/artifact 写操作 fire-and-forget 落库，
 * 供重启恢复 / 审计 / 对账。upsert 幂等，失败静默（不阻断主链路）。
 */
@Injectable()
export class PrismaMirror implements AgentGatewayMirror {
  constructor(private readonly prisma: PrismaService) {}

  /** upsert 并发容错：create 分支撞唯一约束（P2002）说明已存在，幂等忽略 */
  private async upsertSafe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') return; // 已存在（并发镜像）
      throw e;
    }
  }

  async sessionCreated(s: AgentSession): Promise<void> {
    await this.upsertSafe(() =>
      this.prisma.agentGatewaySession.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          tenantId: s.tenantId,
          userId: s.userId,
          agentId: s.agentId,
          workspaceId: s.workspaceId ?? null,
          octopSessionId: s.octopSessionId ?? null,
          mode: s.mode,
          status: s.status,
          lastEventId: s.lastEventId,
          lastSequence: s.lastSequence,
          expiresAt: new Date(s.expiresAt),
        },
        update: {},
      }),
    );
  }

  async sessionUpdated(s: AgentSession): Promise<void> {
    await this.prisma.agentGatewaySession.updateMany({
      where: { id: s.id },
      data: { lastEventId: s.lastEventId, lastSequence: s.lastSequence, status: s.status },
    });
  }

  async taskCreated(t: AgentTask): Promise<void> {
    await this.upsertSafe(() =>
      this.prisma.agentGatewayTask.upsert({
        where: { id: t.id },
        create: {
          id: t.id,
          sessionId: t.sessionId,
          tenantId: t.tenantId,
          userId: t.userId,
          agentId: t.agentId,
          workspaceId: t.workspaceId ?? null,
          type: t.type,
          status: t.status,
          planJson: t.planJson as object,
          checkpointJson: t.checkpointJson as object,
          startedAt: t.startedAt ? new Date(t.startedAt) : null,
          finishedAt: t.finishedAt ? new Date(t.finishedAt) : null,
        },
        update: {},
      }),
    );
  }

  async taskUpdated(t: AgentTask): Promise<void> {
    await this.prisma.agentGatewayTask.updateMany({
      where: { id: t.id },
      data: {
        status: t.status,
        checkpointJson: t.checkpointJson as object,
        startedAt: t.startedAt ? new Date(t.startedAt) : null,
        finishedAt: t.finishedAt ? new Date(t.finishedAt) : null,
      },
    });
  }

  async eventPublished(e: AgentEvent): Promise<void> {
    // 事件不含租户上下文，按 session 归属反查（不变量：事件必须有 tenantId + userId）
    const session = await this.prisma.agentGatewaySession.findUnique({ where: { id: e.sessionId } });
    await this.upsertSafe(() =>
      this.prisma.agentGatewayEvent.upsert({
        where: { sessionId_eventId: { sessionId: e.sessionId, eventId: e.eventId } },
        create: {
          eventId: e.eventId,
          sessionId: e.sessionId,
          tenantId: session?.tenantId ?? '',
          userId: session?.userId ?? '',
          workspaceId: session?.workspaceId ?? null,
          sequence: e.sequence,
          type: e.type,
          taskId: e.taskId,
          payload: e.payload as object,
          occurredAt: new Date(e.occurredAt),
        },
        update: {},
      }),
    );
  }

  async artifactStored(a: Artifact): Promise<void> {
    await this.upsertSafe(() =>
      this.prisma.agentGatewayArtifact.upsert({
        where: { id: a.id },
        create: {
          id: a.id,
          taskId: a.taskId,
          tenantId: a.tenantId,
          type: a.type,
          uri: a.uri,
          checksum: a.checksum,
          version: a.version,
          metadataJson: a.metadataJson as object,
          expiresAt: null,
        },
        update: {},
      }),
    );
  }
}
