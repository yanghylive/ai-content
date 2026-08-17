import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, InteractionTaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

/** 统一收件箱视图（报告 15.4#4：未分配/待处理/已回复/需人工接管/超时） */
export type ThreadView =
  | 'unassigned'
  | 'pending'
  | 'replied'
  | 'needs_human'
  | 'overdue';

/** 事件聚合出的会话线程（同一 externalThreadId 或同一作者+来源） */
export interface InteractionThread {
  key: string;
  platform: string;
  channel: string;
  authorExternalId: string | null;
  sourceArticleId: string | null;
  publishRecordId: string | null;
  latestBody: string | null;
  eventCount: number;
  latestAt: Date;
}

/**
 * 互动线程服务（六步闭环 15.4#4）：把「执行任务」提升为「可运营会话」，
 * 提供统一收件箱的筛选 scope。借鉴 Chatwoot 的 unassigned/assigned scope。
 *
 * 现状：InteractionTask 已有 status/claimedBy/slaDueAt/handoffState，
 * 此服务补齐统一查询入口（按视图筛选）+ 事件线程聚合。
 */
@Injectable()
export class InteractionThreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  /** 解析 tenant+user scope（报告 P1 line628：禁止裸 findMany 泄露租户） */
  private async resolveScope() {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后查看互动任务');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  /** 按视图筛选互动任务（对应统一 Inbox 的保存视图） */
  async listByView(view: ThreadView, limit = 100) {
    const take = Math.min(Math.max(limit, 1), 200);
    const scope = await this.resolveScope();
    const where = {
      ...this.buildViewWhere(view),
      tenantId: scope.tenantId,
      userId: scope.userId,
    };
    return this.prisma.interactionTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take,
    });
  }

  /** 视图 → 查询条件（终态 = COMPLETED/SKIPPED/NO_TARGET） */
  private buildViewWhere(view: ThreadView): Prisma.InteractionTaskWhereInput {
    const terminal: InteractionTaskStatus[] = [
      'COMPLETED',
      'SKIPPED',
      'NO_TARGET',
    ];
    const active: InteractionTaskStatus[] = [
      'QUEUED',
      'RUNNING',
      'WAITING_FOR_SEND_CONFIRMATION',
      'BLOCKED',
      'PAUSED',
    ];
    switch (view) {
      case 'unassigned':
        // 未认领：无进程/人工认领，且非终态
        return { claimedBy: null, status: { notIn: terminal } };
      case 'pending':
        // 待处理：排队/执行中/等待确认/阻塞/暂停
        return { status: { in: active } };
      case 'replied':
        return { status: 'COMPLETED' };
      case 'needs_human':
        // 需人工接管：handoffState=needs_human 且非终态
        return { handoffState: 'needs_human', status: { notIn: terminal } };
      case 'overdue':
        // 超时：SLA 已过且非终态
        return {
          slaDueAt: { lt: new Date() },
          status: { notIn: terminal },
        };
      default:
        return {};
    }
  }

  /** 聚合互动事件成会话线程（同一 externalThreadId，无则按 作者+来源+渠道） */
  async listEventThreads(input: {
    platform?: string;
    limit?: number;
  }): Promise<InteractionThread[]> {
    const take = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const scope = await this.resolveScope();
    const events = await this.prisma.interactionEvent.findMany({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        ...(input.platform ? { platform: input.platform } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take,
    });

    const threads = new Map<string, InteractionThread>();
    for (const event of events) {
      const key =
        event.externalThreadId ??
        `${event.channel}:${event.sourceUrl ?? ''}:${event.authorExternalId ?? ''}`;
      const existing = threads.get(key);
      if (existing) {
        existing.eventCount += 1;
        if (event.occurredAt > existing.latestAt) {
          existing.latestAt = event.occurredAt;
          existing.latestBody = event.body;
        }
      } else {
        threads.set(key, {
          key,
          platform: event.platform,
          channel: event.channel,
          authorExternalId: event.authorExternalId,
          sourceArticleId: event.sourceArticleId,
          publishRecordId: event.publishRecordId,
          latestBody: event.body,
          eventCount: 1,
          latestAt: event.occurredAt,
        });
      }
    }

    return [...threads.values()].sort(
      (a, b) => b.latestAt.getTime() - a.latestAt.getTime(),
    );
  }

  /**
   * 线程详情（Sprint 5 T5.8 Conversation 增量）：
   * 某线程的全部互动事件按时间 + parentEventId 排序成回复串，
   * 每事件带 作者/身份/证据链接。互动记录展示基础。
   */
  async threadDetail(input: {
    key: string;
    limit?: number;
  }): Promise<{
    key: string;
    events: Array<{
      id: string;
      channel: string;
      authorExternalId: string | null;
      identityId: string | null;
      body: string | null;
      occurredAt: Date;
      sourceUrl: string | null;
      evidenceUrl: string | null;
      externalEventId: string | null;
      parentEventId: string | null;
    }>;
    total: number;
  }> {
    const take = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const scope = await this.resolveScope();
    const events = await this.prisma.interactionEvent.findMany({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
      },
      orderBy: [{ occurredAt: 'asc' }],
      take,
    });

    // 按线程键归组（与 listEventThreads 同键规则）
    const threadEvents = events.filter((e) => {
      const key =
        e.externalThreadId ??
        `${e.channel}:${e.sourceUrl ?? ''}:${e.authorExternalId ?? ''}`;
      return key === input.key;
    });

    // parentEventId 排序：先按时间，父事件在前（回复串）
    const byId = new Map(threadEvents.map((e) => [e.id, e]));
    const children = new Map<string, typeof threadEvents>();
    const roots: typeof threadEvents = [];
    for (const e of threadEvents) {
      if (e.parentEventId && byId.has(e.parentEventId)) {
        const list = children.get(e.parentEventId) ?? [];
        list.push(e);
        children.set(e.parentEventId, list);
      } else {
        roots.push(e);
      }
    }
    const ordered: typeof threadEvents = [];
    const visit = (e: (typeof threadEvents)[number]) => {
      ordered.push(e);
      for (const child of children.get(e.id) ?? []) visit(child);
    };
    for (const r of roots) visit(r);

    return {
      key: input.key,
      events: ordered.map((e) => ({
        id: e.id,
        channel: e.channel,
        authorExternalId: e.authorExternalId,
        identityId: e.identityId,
        body: e.body,
        occurredAt: e.occurredAt,
        sourceUrl: e.sourceUrl,
        evidenceUrl: e.evidenceUrl,
        externalEventId: e.externalEventId,
        parentEventId: e.parentEventId,
      })),
      total: ordered.length,
    };
  }
}
