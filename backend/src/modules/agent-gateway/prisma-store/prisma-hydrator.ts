import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AgentSession, AgentTask, AgentEvent, Artifact, ToolRequest } from '../core/types';

export interface HydrationData {
  sessions: AgentSession[];
  tasks: AgentTask[];
  artifacts: Artifact[];
  events: AgentEvent[];
  /** 重启恢复：awaiting_confirmation 任务的 pending（审批/恢复不 CHECKPOINT_MISSING） */
  pending: Array<{ taskId: string; request: ToolRequest; toolCallId: string; approvalId?: string }>;
}

/**
 * 重启恢复读取器：从 agent_gateway_* 反灌引擎内存（写路径镜像的读侧）。
 * 只恢复 active 且未过期的会话及其任务/事件/产物——已过期/终态资源不复活。
 */
@Injectable()
export class PrismaHydrator {
  constructor(private readonly prisma: PrismaService) {}

  async hydrate(): Promise<HydrationData> {
    const now = new Date();
    const sessionRows = await this.prisma.agentGatewaySession.findMany({
      where: { status: 'active', expiresAt: { gt: now } },
    });
    const sessions: AgentSession[] = sessionRows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      agentId: r.agentId,
      octopSessionId: r.octopSessionId ?? undefined,
      mode: r.mode as AgentSession['mode'],
      status: r.status as AgentSession['status'],
      lastEventId: r.lastEventId,
      lastSequence: r.lastSequence,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));

    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return { sessions: [], tasks: [], artifacts: [], events: [], pending: [] };

    const [taskRows, eventRows] = await Promise.all([
      this.prisma.agentGatewayTask.findMany({ where: { sessionId: { in: ids } } }),
      this.prisma.agentGatewayEvent.findMany({ where: { sessionId: { in: ids } } }),
    ]);

    const tasks: AgentTask[] = taskRows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      tenantId: r.tenantId,
      userId: r.userId,
      agentId: r.agentId,
      type: r.type,
      status: r.status as AgentTask['status'],
      planJson: (r.planJson ?? {}) as Record<string, unknown>,
      checkpointJson: (r.checkpointJson ?? {}) as Record<string, unknown>,
      startedAt: r.startedAt?.toISOString() ?? undefined,
      finishedAt: r.finishedAt?.toISOString() ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));

    const artifactRows = await this.prisma.agentGatewayArtifact.findMany({
      where: { taskId: { in: tasks.map((t) => t.id) } },
    });
    const artifacts: Artifact[] = artifactRows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      tenantId: r.tenantId,
      type: r.type,
      uri: r.uri,
      checksum: r.checksum,
      version: r.version,
      metadataJson: (r.metadataJson ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));

    const events: AgentEvent[] = eventRows.map((r) => ({
      eventId: r.eventId,
      sequence: r.sequence,
      type: r.type as AgentEvent['type'],
      taskId: r.taskId,
      sessionId: r.sessionId,
      occurredAt: r.occurredAt.toISOString(),
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));

    // P1-6：重建 awaiting_confirmation 的 pending（approve/resume 不 CHECKPOINT_MISSING）
    const awaitingTaskIds = tasks.filter((t) => t.status === 'awaiting_confirmation').map((t) => t.id);
    let pending: HydrationData['pending'] = [];
    if (awaitingTaskIds.length > 0) {
      const [toolCallRows, approvalRows] = await Promise.all([
        this.prisma.agentGatewayToolCall.findMany({ where: { taskId: { in: awaitingTaskIds }, status: 'running' } }),
        this.prisma.agentGatewayApproval.findMany({ where: { taskId: { in: awaitingTaskIds }, status: 'pending', consumed: false } }),
      ]);
      for (const t of tasks.filter((x) => x.status === 'awaiting_confirmation')) {
        const tc = toolCallRows.find((x) => x.taskId === t.id);
        const apr = approvalRows.find((x) => x.taskId === t.id);
        if (tc?.requestJson) {
          try {
            pending.push({
              taskId: t.id,
              request: JSON.parse(tc.requestJson) as ToolRequest,
              toolCallId: tc.id,
              approvalId: apr?.id,
            });
          } catch {
            /* 损坏的 requestJson 跳过（该任务恢复后需重新提交） */
          }
        }
      }
    }

    return { sessions, tasks, artifacts, events, pending };
  }
}
