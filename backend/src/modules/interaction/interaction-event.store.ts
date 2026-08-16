import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { InteractionEvent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  /** 去重键：tenantId + platform + accountId + (eventId??threadId??sourceUrl) + body */
  computeDedupeKey(event: InteractionEventInput): string {
    const identity =
      event.externalEventId ?? event.externalThreadId ?? event.sourceUrl ?? '';
    return createHash('sha256')
      .update(
        [
          event.tenantId ?? DEFAULT_TENANT,
          event.platform,
          event.accountId ?? '',
          identity,
          event.body,
        ].join('|'),
      )
      .digest('hex');
  }

  /** 幂等写入：同 dedupeKey 不重复创建，返回 created=false */
  async ingest(
    event: InteractionEventInput,
  ): Promise<{ event: InteractionEvent; created: boolean }> {
    const tenantId = event.tenantId ?? DEFAULT_TENANT;
    const dedupeKey = this.computeDedupeKey(event);

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
          userId: event.userId ?? DEFAULT_USER,
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
          raw: (event.raw ?? undefined) as Prisma.InputJsonValue | undefined,
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
      raw: item as unknown,
    };
  }

  /** 按来源内容查事件（归因用） */
  listByArticle(articleId: string, limit = 100) {
    return this.prisma.interactionEvent.findMany({
      where: { sourceArticleId: articleId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  /** 按作者查历史事件（识别同一人历史会话） */
  listByAuthor(authorExternalId: string, limit = 50) {
    return this.prisma.interactionEvent.findMany({
      where: { authorExternalId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }
}
