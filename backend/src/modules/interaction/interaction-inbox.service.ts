import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { InteractionEvent, InteractionTask, Lead } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

/**
 * 统一收件箱（报告 5.1 节）：把「平台侧事实（InteractionEvent）」「团队动作
 * （InteractionTask）」「线索（Lead）」「内容来源（Article）」合并成一条
 * 可运营的会话线程，供三栏 Inbox（左：视图 / 中：会话 / 右：详情）消费。
 *
 * 与 InteractionThreadService 的分工：
 * - InteractionThreadService：按视图筛任务 + 事件线程聚合（纯查询原语）；
 * - InteractionInboxService：在此之上做「会话 → 任务状态 / SLA / 线索 / 内容」聚合，
 *   是统一 Inbox 的唯一读入口，包含 tenant+user scope 隔离。
 */

export type InboxView =
  | 'all'
  | 'unassigned'
  | 'pending'
  | 'replied'
  | 'needs_human'
  | 'overdue';

/** 三栏 Inbox 的中栏/右栏统一条目 */
export interface InboxItem {
  threadKey: string;
  platform: string;
  channel: string;
  accountId: string | null;
  authorExternalId: string | null;
  authorName: string | null;
  // 内容来源（报告 5.1：内容来源）
  sourceArticleId: string | null;
  sourceArticleTitle: string | null;
  publishRecordId: string | null;
  sourceUrl: string | null;
  // 会话（中栏：未读 / 最新消息）
  latestBody: string | null;
  latestAt: Date;
  eventCount: number;
  unreadCount: number;
  // 团队动作状态（中栏：优先级 / 超时 / 负责人）
  priority: string;
  status: string; // 任务状态，无任务时为 'new'
  slaDueAt: Date | null;
  slaOverdue: boolean;
  assigneeId: string | null;
  handoffState: string;
  handoffReason: string | null;
  // 右栏：回复草稿 + 线索/CRM 关联
  draftText: string | null;
  leadId: string | null;
  leadStatus: string | null;
  customerId: string | null;
  allowedActions: string[];
}

export interface InboxListInput {
  view?: InboxView;
  platform?: string;
  assignee?: 'me' | 'unassigned' | string;
  limit?: number;
  offset?: number;
}

export interface InboxListResult {
  items: InboxItem[];
  total: number;
  /** 左栏各视图计数 */
  views: Record<InboxView, number>;
}

interface Scope {
  tenantId: string;
  userId: string;
}

const TERMINAL_TASK = new Set(['COMPLETED', 'SKIPPED', 'NO_TARGET']);

/**
 * 会话线程聚合键：有 externalThreadId 用它；否则用 渠道:来源URL:作者。
 * 与 InteractionThreadService.listEventThreads 保持同一规则，保证前后一致。
 */
function threadKeyOf(event: Pick<
  InteractionEvent,
  'externalThreadId' | 'channel' | 'sourceUrl' | 'authorExternalId'
>): string {
  return (
    event.externalThreadId ??
    `${event.channel}:${event.sourceUrl ?? ''}:${event.authorExternalId ?? ''}`
  );
}

@Injectable()
export class InteractionInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  private async resolveScope(): Promise<Scope> {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后查看互动收件箱');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  /** 统一收件箱列表：事件线程 + 任务状态/SLA + 线索/CRM + 内容标题 */
  async listInbox(input: InboxListInput = {}): Promise<InboxListResult> {
    const scope = await this.resolveScope();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const offset = Math.max(input.offset ?? 0, 0);

    const [events, tasks, leads, articles] = await Promise.all([
      this.fetchEvents(scope),
      this.fetchTasks(scope),
      this.fetchLeads(scope),
      this.fetchArticles(scope),
    ]);

    // 聚合事件 → 会话线程
    const threads = this.aggregateThreads(events);

    // 内容标题索引（sourceArticleId → title）
    const titleById = new Map(articles.map((a) => [a.id, a.title]));

    // 任务/线索索引（按归因键）
    const taskIndex = this.indexTasks(tasks);
    const leadIndex = this.indexLeads(leads);

    const items: InboxItem[] = [];
    for (const thread of threads) {
      const task = this.matchTask(thread, taskIndex);
      const lead = this.matchLead(thread, leadIndex);

      const slaDueAt = task?.slaDueAt ?? null;
      const status = task?.status ?? 'new';
      const handoffState = task?.handoffState ?? 'normal';
      const slaOverdue =
        slaDueAt != null &&
        slaDueAt.getTime() < Date.now() &&
        !TERMINAL_TASK.has(status);
      const assigneeId = task?.claimedBy ?? null;

      // 未读：任务尚未动作过的后续事件（无任务则全部未读）
      const lastActedAt = task?.updatedAt?.getTime() ?? 0;
      const unreadCount =
        lastActedAt > 0
          ? thread.events.filter((e) => e.occurredAt.getTime() > lastActedAt)
              .length
          : thread.eventCount;

      items.push({
        threadKey: thread.key,
        platform: thread.platform,
        channel: thread.channel,
        accountId: thread.accountId,
        authorExternalId: thread.authorExternalId,
        authorName: this.resolveAuthorName(thread, lead),
        sourceArticleId: thread.sourceArticleId,
        sourceArticleTitle: thread.sourceArticleId
          ? (titleById.get(thread.sourceArticleId) ?? null)
          : null,
        publishRecordId: thread.publishRecordId,
        sourceUrl: thread.sourceUrl,
        latestBody: thread.latestBody,
        latestAt: thread.latestAt,
        eventCount: thread.eventCount,
        unreadCount,
        priority: this.resolvePriority(task, handoffState),
        status,
        slaDueAt,
        slaOverdue,
        assigneeId,
        handoffState,
        handoffReason: task?.handoffReason ?? null,
        draftText: task?.draftText ?? null,
        leadId: lead?.id ?? null,
        leadStatus: lead?.status ?? null,
        customerId: lead?.customerId ?? null,
        allowedActions: this.resolveAllowedActions(status, handoffState, assigneeId),
      });
    }

    // 视图过滤（在聚合后做，保证视图计数一致）
    const filtered = items.filter((item) =>
      this.matchView(item, input.view ?? 'all'),
    );
    const platform = input.platform?.trim();
    const platformFiltered = platform
      ? filtered.filter((item) => item.platform === platform)
      : filtered;

    const assignee = input.assignee?.trim();
    const assigneeFiltered = !assignee
      ? platformFiltered
      : assignee === 'me'
        ? platformFiltered.filter((item) => item.assigneeId === scope.userId)
        : assignee === 'unassigned'
          ? platformFiltered.filter((item) => item.assigneeId === null)
          : platformFiltered.filter((item) => item.assigneeId === assignee);

    const total = assigneeFiltered.length;
    const paged = assigneeFiltered.slice(offset, offset + limit);

    return {
      items: paged,
      total,
      views: this.countViews(items),
    };
  }

  /** 右栏会话详情：历史事件 + 任务 + 线索 + 内容标题 */
  async getThreadDetail(threadKey: string): Promise<{
    thread: InboxItem;
    history: Array<{
      eventId: string;
      body: string | null;
      occurredAt: Date;
      channel: string;
      platform: string;
    }>;
  }> {
    const scope = await this.resolveScope();
    const events = await this.prisma.interactionEvent.findMany({
      where: { tenantId: scope.tenantId, userId: scope.userId },
      orderBy: { occurredAt: 'asc' },
    });

    const threads = this.aggregateThreads(events);
    const thread = threads.find((t) => t.key === threadKey);
    if (!thread) {
      return {
        thread: null as unknown as InboxItem,
        history: [],
      };
    }

    const [tasks, leads, articles] = await Promise.all([
      this.fetchTasks(scope),
      this.fetchLeads(scope),
      this.fetchArticles(scope),
    ]);
    const titleById = new Map(articles.map((a) => [a.id, a.title]));
    const task = this.matchTask(thread, this.indexTasks(tasks));
    const lead = this.matchLead(thread, this.indexLeads(leads));
    const slaDueAt = task?.slaDueAt ?? null;
    const status = task?.status ?? 'new';
    const handoffState = task?.handoffState ?? 'normal';
    const assigneeId = task?.claimedBy ?? null;
    const lastActedAt = task?.updatedAt?.getTime() ?? 0;
    const unreadCount =
      lastActedAt > 0
        ? thread.events.filter((e) => e.occurredAt.getTime() > lastActedAt)
            .length
        : thread.eventCount;

    const item: InboxItem = {
      threadKey: thread.key,
      platform: thread.platform,
      channel: thread.channel,
      accountId: thread.accountId,
      authorExternalId: thread.authorExternalId,
      authorName: this.resolveAuthorName(thread, lead),
      sourceArticleId: thread.sourceArticleId,
      sourceArticleTitle: thread.sourceArticleId
        ? (titleById.get(thread.sourceArticleId) ?? null)
        : null,
      publishRecordId: thread.publishRecordId,
      sourceUrl: thread.sourceUrl,
      latestBody: thread.latestBody,
      latestAt: thread.latestAt,
      eventCount: thread.eventCount,
      unreadCount,
      priority: this.resolvePriority(task, handoffState),
      status,
      slaDueAt,
      slaOverdue:
        slaDueAt != null &&
        slaDueAt.getTime() < Date.now() &&
        !TERMINAL_TASK.has(status),
      assigneeId,
      handoffState,
      handoffReason: task?.handoffReason ?? null,
      draftText: task?.draftText ?? null,
      leadId: lead?.id ?? null,
      leadStatus: lead?.status ?? null,
      customerId: lead?.customerId ?? null,
      allowedActions: this.resolveAllowedActions(status, handoffState, assigneeId),
    };

    return {
      thread: item,
      history: thread.events
        .slice()
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
        .map((e) => ({
          eventId: e.id,
          body: e.body,
          occurredAt: e.occurredAt,
          channel: e.channel,
          platform: e.platform,
        })),
    };
  }

  // ===== 数据拉取（均带 scope） =====

  private fetchEvents(scope: Scope) {
    return this.prisma.interactionEvent.findMany({
      where: { tenantId: scope.tenantId, userId: scope.userId },
      orderBy: { occurredAt: 'desc' },
      take: 1000,
    });
  }

  private fetchTasks(scope: Scope) {
    return this.prisma.interactionTask.findMany({
      where: { tenantId: scope.tenantId, userId: scope.userId },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    });
  }

  private fetchLeads(scope: Scope) {
    return this.prisma.lead.findMany({
      where: { tenantId: scope.tenantId, userId: scope.userId },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    });
  }

  private fetchArticles(scope: Scope) {
    return this.prisma.article.findMany({
      where: { tenantId: scope.tenantId, userId: scope.userId },
      select: { id: true, title: true },
    });
  }

  // ===== 聚合逻辑 =====

  private aggregateThreads(events: InteractionEvent[]) {
    const map = new Map<
      string,
      {
        key: string;
        platform: string;
        channel: string;
        accountId: string | null;
        authorExternalId: string | null;
        sourceArticleId: string | null;
        publishRecordId: string | null;
        sourceUrl: string | null;
        latestBody: string | null;
        latestAt: Date;
        eventCount: number;
        events: InteractionEvent[];
      }
    >();

    for (const event of events) {
      const key = threadKeyOf(event);
      const existing = map.get(key);
      if (existing) {
        existing.eventCount += 1;
        existing.events.push(event);
        if (event.occurredAt.getTime() > existing.latestAt.getTime()) {
          existing.latestAt = event.occurredAt;
          existing.latestBody = event.body;
        }
        // 补全来源内容（后续事件可能带更全的归因信息）
        existing.sourceArticleId ??= event.sourceArticleId;
        existing.publishRecordId ??= event.publishRecordId;
        existing.sourceUrl ??= event.sourceUrl;
      } else {
        map.set(key, {
          key,
          platform: event.platform,
          channel: event.channel,
          accountId: event.accountId,
          authorExternalId: event.authorExternalId,
          sourceArticleId: event.sourceArticleId,
          publishRecordId: event.publishRecordId,
          sourceUrl: event.sourceUrl,
          latestBody: event.body,
          latestAt: event.occurredAt,
          eventCount: 1,
          events: [event],
        });
      }
    }

    return [...map.values()].sort(
      (a, b) => b.latestAt.getTime() - a.latestAt.getTime(),
    );
  }

  private indexTasks(tasks: InteractionTask[]) {
    const byArticle = new Map<string, InteractionTask>();
    const byPublish = new Map<string, InteractionTask>();
    const byUrl = new Map<string, InteractionTask>();
    const bySession = new Map<string, InteractionTask>();
    for (const task of tasks) {
      if (task.sourceArticleId) byArticle.set(task.sourceArticleId, task);
      if (task.publishRecordId) byPublish.set(task.publishRecordId, task);
      if (task.sourceUrl) byUrl.set(task.sourceUrl, task);
      if (task.sessionId) bySession.set(task.sessionId, task);
    }
    return { byArticle, byPublish, byUrl, bySession };
  }

  private indexLeads(leads: Lead[]) {
    const byEvent = new Map<string, Lead>();
    const byArticle = new Map<string, Lead>();
    const byPublish = new Map<string, Lead>();
    const byUrl = new Map<string, Lead>();
    const byExternalUser = new Map<string, Lead>();
    for (const lead of leads) {
      if (lead.sourceInteractionEventId) {
        byEvent.set(lead.sourceInteractionEventId, lead);
      }
      if (lead.sourceArticleId) byArticle.set(lead.sourceArticleId, lead);
      if (lead.sourcePublishRecordId) {
        byPublish.set(lead.sourcePublishRecordId, lead);
      }
      if (lead.sourceUrl) byUrl.set(lead.sourceUrl, lead);
      if (lead.externalUserId) byExternalUser.set(lead.externalUserId, lead);
    }
    return { byEvent, byArticle, byPublish, byUrl, byExternalUser };
  }

  private matchTask(
    thread: { sourceArticleId: string | null; publishRecordId: string | null; sourceUrl: string | null },
    index: ReturnType<InteractionInboxService['indexTasks']>,
  ): InteractionTask | null {
    if (thread.sourceArticleId && index.byArticle.has(thread.sourceArticleId)) {
      return index.byArticle.get(thread.sourceArticleId)!;
    }
    if (thread.publishRecordId && index.byPublish.has(thread.publishRecordId)) {
      return index.byPublish.get(thread.publishRecordId)!;
    }
    if (thread.sourceUrl && index.byUrl.has(thread.sourceUrl)) {
      return index.byUrl.get(thread.sourceUrl)!;
    }
    return null;
  }

  private matchLead(
    thread: {
      sourceArticleId: string | null;
      publishRecordId: string | null;
      sourceUrl: string | null;
      authorExternalId: string | null;
      events: Array<{ id: string }>;
    },
    index: ReturnType<InteractionInboxService['indexLeads']>,
  ): Lead | null {
    // 事件级直连优先（lead.sourceInteractionEventId → 线程内某事件的 id）
    for (const event of thread.events) {
      if (index.byEvent.has(event.id)) {
        return index.byEvent.get(event.id)!;
      }
    }
    if (thread.sourceArticleId && index.byArticle.has(thread.sourceArticleId)) {
      return index.byArticle.get(thread.sourceArticleId)!;
    }
    if (thread.publishRecordId && index.byPublish.has(thread.publishRecordId)) {
      return index.byPublish.get(thread.publishRecordId)!;
    }
    if (thread.sourceUrl && index.byUrl.has(thread.sourceUrl)) {
      return index.byUrl.get(thread.sourceUrl)!;
    }
    if (
      thread.authorExternalId &&
      index.byExternalUser.has(thread.authorExternalId)
    ) {
      return index.byExternalUser.get(thread.authorExternalId)!;
    }
    return null;
  }

  private resolveAuthorName(
    thread: { authorExternalId: string | null },
    lead: Lead | null,
  ): string | null {
    return lead?.nickname ?? thread.authorExternalId ?? null;
  }

  private resolvePriority(
    task: InteractionTask | null,
    handoffState: string,
  ): string {
    if (handoffState === 'needs_human') return 'high';
    return task?.riskLevel ?? 'medium';
  }

  private resolveAllowedActions(
    status: string,
    handoffState: string,
    assigneeId: string | null,
  ): string[] {
    if (handoffState === 'needs_human') {
      return ['reply', 'handoff-resolve', 'assign', 'create-lead'];
    }
    if (TERMINAL_TASK.has(status)) {
      return ['create-lead', 'archive'];
    }
    if (assigneeId == null) {
      return ['assign', 'reply', 'handoff', 'create-lead'];
    }
    return ['reply', 'handoff', 'create-lead', 'reassign'];
  }

  private matchView(item: InboxItem, view: InboxView): boolean {
    switch (view) {
      case 'all':
        return true;
      case 'unassigned':
        return item.assigneeId === null && !TERMINAL_TASK.has(item.status);
      case 'pending':
        return !TERMINAL_TASK.has(item.status);
      case 'replied':
        return item.status === 'COMPLETED';
      case 'needs_human':
        return item.handoffState === 'needs_human' && !TERMINAL_TASK.has(item.status);
      case 'overdue':
        return item.slaOverdue;
      default:
        return true;
    }
  }

  private countViews(items: InboxItem[]): Record<InboxView, number> {
    const views: InboxView[] = [
      'all',
      'unassigned',
      'pending',
      'replied',
      'needs_human',
      'overdue',
    ];
    const counts = {
      all: 0,
      unassigned: 0,
      pending: 0,
      replied: 0,
      needs_human: 0,
      overdue: 0,
    } as Record<InboxView, number>;
    for (const view of views) {
      counts[view] = items.filter((item) => this.matchView(item, view)).length;
    }
    return counts;
  }
}
