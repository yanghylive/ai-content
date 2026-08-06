import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import type { AgentSession } from '../local-engine/local-engine.types';

/**
 * 发布跟踪会话服务（依赖环拆除专用）
 *
 * 原实现位于 local-engine.service.createPublishTrackingSession，
 * auto-upload 仅此一处调用却造成 local-engine ↔ auto-upload 模块互引。
 * 本服务下沉等价逻辑，auto-upload 自给自足，破环后 local-engine 保持单向依赖。
 */
@Injectable()
export class PublishTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  /** 创建发布跟踪会话（与 local-engine 原实现行为一致） */
  async createPublishTrackingSession(input: {
    title: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentSession> {
    const tenantId = await this.resolveTenantId();
    const user = this.authRequestContext?.get()?.user;
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: this.createId(),
      tenantId: tenantId ?? 'legacy-local-desktop',
      userId: user?.id ?? 'legacy-local-user',
      title: input.title.trim() || '发布任务',
      instruction: `记录发布任务：${input.title.trim() || '发布任务'}`,
      status: 'running',
      statusLabel: '运行中',
      executionScope: 'browser',
      source: 'publishing',
      createdAt: now,
      updatedAt: now,
      targetApp: '发布中心',
      riskLevel: 'high',
      requiresDoubleConfirmation: false,
      metadata: input.metadata,
      confirmations: [],
      events: [],
    };
    session.events = [
      {
        id: this.createId(),
        sessionId: session.id,
        level: 'info',
        title: '发布任务已创建',
        message: '发布任务已经进入执行记录，平台结果会持续写入本次会话。',
        createdAt: now,
      },
    ];
    await this.persist(session);
    return session;
  }

  /** 完成发布跟踪会话（与 local-engine.completePublishTrackingSession 行为一致） */
  async completePublishTrackingSession(
    id: string,
    input: { ok: boolean; message: string; evidenceCount?: number },
  ): Promise<AgentSession> {
    const row = await this.prisma.agentSession.findUnique({ where: { id } });
    if (!row) {
      throw new Error(`发布跟踪会话不存在：${id}`);
    }
    const session = (row.sessionJson ?? {}) as unknown as AgentSession;
    const now = new Date().toISOString();
    session.status = input.ok ? 'completed' : 'failed';
    session.statusLabel = input.ok ? '已完成' : '执行失败';
    session.completedAt = now;
    session.updatedAt = now;
    session.nextAction = input.ok
      ? '请在发布记录查看平台回执和结果留存。'
      : '请查看失败原因，修复账号、素材或平台状态后重试。';
    session.events = [
      ...(session.events ?? []),
      {
        id: this.createId(),
        sessionId: session.id,
        level: input.ok ? 'success' : 'error',
        title: input.ok ? '发布执行完成' : '发布执行失败',
        message: input.message,
        createdAt: now,
      },
    ];
    session.metadata = {
      ...(session.metadata || {}),
      evidenceCount: input.evidenceCount ?? 0,
    };
    await this.persist(session);
    return session;
  }

  private async persist(session: AgentSession) {
    if (!session.tenantId || !session.userId) {
      throw new Error('Agent 会话缺少租户归属，已拒绝写入。');
    }
    const sessionJson = session as unknown as Prisma.InputJsonValue;
    const data = {
      tenantId: session.tenantId,
      userId: session.userId,
      title: session.title,
      instruction: session.instruction,
      source: session.source === 'agent-console' ? 'agent_console' : (session.source ?? 'web'),
      status: session.status,
      scope: session.executionScope,
      targetApp: session.targetApp ?? null,
      riskLevel: session.riskLevel ?? null,
      events: session.events ?? [],
      confirmations: session.confirmations ?? [],
      evidence: [],
      sessionJson,
      completedAt: session.completedAt ? new Date(session.completedAt) : null,
    };
    await this.prisma.agentSession.upsert({
      where: {
        id: session.id,
        tenantId: session.tenantId,
        userId: session.userId,
      },
      create: {
        id: session.id,
        ...data,
        createdAt: new Date(session.createdAt),
      },
      update: data,
    });
  }

  private async resolveTenantId(): Promise<string | undefined> {
    if (typeof this.authRequestContext?.resolveTenantId === 'function') {
      try {
        return await this.authRequestContext.resolveTenantId(this.prisma);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private createId(): string {
    return `sess_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }
}
