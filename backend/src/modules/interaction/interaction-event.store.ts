import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { InteractionEvent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import type { InteractionItem } from './interaction-adapter.interface';

export type InteractionChannel = 'comment' | 'dm' | 'mention' | 'form';

/** 平台侧互动事实（报告 15.4#3 InteractionEvent 形状） */
export interface InteractionEventInput {
  tenantId?: string;
  userId?: string;
  platform: string;
  accountId?: string;
  channel?: InteractionChannel;
  /** 平台定位序号（小红书评论序号 / 抖音评论 ref），事件级唯一去重首选 */
  externalEventId?: string;
  /** 会话线程 ID（私信会话），无事件 ID 时的去重回退 */
  externalThreadId?: string;
  /** 作者外部 ID */
  authorExternalId?: string;
  sourceUrl?: string;
  sourceArticleId?: string;
  publishRecordId?: string;
  body: string;
  occurredAt?: Date;
  raw?: unknown;
}

const DEFAULT_TENANT = 'legacy-local-desktop';
const DEFAULT_USER = 'legacy-local-user';

/**
 * 互动事件存储（六步闭环 15.4#3）：把「平台侧事实」从「团队动作
 * (InteractionTask)」中独立出来，统一事件形状 + dedupeKey 幂等去重。
 *
 * 去重规则（报告 15.3）：
 * - 有 externalEventId 时按平台事件 ID 唯一去重；
 * - 无事件 ID 时回退 externalThreadId → sourceUrl；
 * - 同 dedupeKey 重复采集直接返回已有事件，不重复入库。
 */
@Injectable()
export class InteractionEventStore {
  private readonly logger = new Logger(InteractionEventStore.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  /**
   * 解析事件归属 scope。优先用显式传入的 tenantId/userId；否则从登录上下文
   * resolve 真实 scope（对齐 InteractionTask 的 persist 路径），保证事件与任务
   * 的 tenantId 一致——否则读层（Inbox/Thread）按真实 scope 过滤会查不到事件。
   * 无上下文（后台任务/测试）回退 legacy 默认。
   */
  private async resolveScope(
    tenantId: string | undefined,
    userId: string | undefined,
  ): Promise<{ tenantId: string; userId: string }> {
    if (tenantId && userId) {
      return { tenantId, userId };
    }
    const context = this.authRequestContext.get();
    const contextUserId = context?.user?.id?.trim() || '';
    if (contextUserId) {
      try {
        const resolvedTenantId = await this.authRequestContext.resolveTenantId(
          this.prisma,
        );
        return {
          tenantId: tenantId ?? resolvedTenantId,
          userId: userId ?? contextUserId,
        };
      } catch (error) {
        // P0 复核（全面审查）：解析失败降级 legacy 但不静默——写审计日志，
        // 否则事件落 legacy 租户后真实 scope 查不到（归因丢失/串租户），排查无痕
        this.logger.warn(
          `InteractionEvent 租户解析失败，降级 legacy 默认（user=${contextUserId}）：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return {
      tenantId: tenantId ?? DEFAULT_TENANT,
      userId: userId ?? DEFAULT_USER,
    };
  }

  /**
   * 去重键：真实 event/thread ID 优先；没有平台 ID 时，加入作者、正文和
   * 采集时间作为弱键。绝不由 URL+正文伪造“平台事件 ID”，否则同文评论会被
   * 错误合并且无法回溯原始平台事件。
   */
  computeDedupeKey(event: InteractionEventInput): string {
    const identity = event.externalEventId ?? event.externalThreadId ?? '';
    const fallback = identity
      ? identity
      : [
          'unidentified',
          event.sourceUrl ?? '',
          event.authorExternalId ?? '',
          event.body,
          event.occurredAt?.toISOString() ?? '',
        ].join('|');
    return createHash('sha256')
      .update(
        [
          event.tenantId ?? DEFAULT_TENANT,
          event.platform,
          event.accountId ?? '',
          fallback,
        ].join('|'),
      )
      .digest('hex');
  }

  /** 幂等写入：同 dedupeKey 不重复创建，返回 created=false */
  async ingest(
    event: InteractionEventInput,
  ): Promise<{ event: InteractionEvent; created: boolean }> {
    const scope = await this.resolveScope(event.tenantId, event.userId);
    const tenantId = scope.tenantId;
    const userId = scope.userId;
    const dedupeKey = this.computeDedupeKey({ ...event, tenantId });

    const existing = await this.prisma.interactionEvent.findUnique({
      where: { tenantId_dedupeKey: { tenantId, dedupeKey } },
    });
    if (existing) {
      return { event: existing, created: false };
    }

    const created = await this.prisma.interactionEvent
      .create({
        data: {
          tenantId,
          userId,
          platform: event.platform,
          accountId: event.accountId,
          channel: event.channel ?? 'comment',
          externalEventId: event.externalEventId,
          externalThreadId: event.externalThreadId,
          authorExternalId: event.authorExternalId,
          sourceUrl: event.sourceUrl,
          sourceArticleId: event.sourceArticleId,
          publishRecordId: event.publishRecordId,
          body: event.body,
          dedupeKey,
          occurredAt: event.occurredAt ?? new Date(),
          raw: event.raw ?? undefined,
        },
      })
      .catch((error: unknown) => {
        // S0-P1 竞态：并发同 dedupeKey 撞唯一约束（P2002）时，重查返回已有事件
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return this.prisma.interactionEvent.findUniqueOrThrow({
            where: { tenantId_dedupeKey: { tenantId, dedupeKey } },
          });
        }
        throw error;
      });
    return { event: created, created: true };
  }

  /** 从 adapter 读取的 InteractionItem 映射为事件（供采集链路调用） */
  fromInteractionItem(
    platform: string,
    accountId: string | number | undefined,
    item: InteractionItem,
    context: {
      sourceUrl?: string;
      sourceArticleId?: string;
      publishRecordId?: string;
      channel?: InteractionChannel;
    } = {},
  ): InteractionEventInput {
    return {
      platform,
      accountId: accountId != null ? String(accountId) : undefined,
      channel: context.channel ?? 'comment',
      externalEventId: item.ref,
      authorExternalId: item.authorId,
      sourceUrl: context.sourceUrl ?? item.videoUrl,
      sourceArticleId: context.sourceArticleId,
      publishRecordId: context.publishRecordId,
      body: item.text,
      occurredAt: item.commentTime ? new Date(item.commentTime) : undefined,
      raw: item,
    };
  }

  /** 按来源内容查事件（归因用，P1-15 复核：强制 tenant scope 防串租户） */
  listByArticle(articleId: string, tenantId: string, limit = 100) {
    return this.prisma.interactionEvent.findMany({
      where: { sourceArticleId: articleId, tenantId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  /** 按作者查历史事件（识别同一人历史会话，P1-15 复核：强制 tenant scope 防串租户） */
  listByAuthor(authorExternalId: string, tenantId: string, limit = 50) {
    return this.prisma.interactionEvent.findMany({
      where: { authorExternalId, tenantId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }
}
