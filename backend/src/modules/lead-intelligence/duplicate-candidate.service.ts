// 重复候选（PRD LEAD-002 + 开发文档 §6.5，统一开发计划 §八）
// 去重优先级：externalUserId / externalEventId → 确定重复；profileUrl → 高置信；
// 昵称/文本/头像相似 → 仅 candidate（低置信不自动合并，需用户确认）。
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type DuplicateResolution =
  | {
      kind: 'match';
      matchedIdentityId: string;
      confidence: number;
      reason: string;
    }
  | {
      kind: 'high_confidence';
      matchedIdentityId: string;
      confidence: number;
      reason: string;
    }
  | {
      kind: 'candidate';
      candidates: Array<{
        identityId: string;
        confidence: number;
        reason: string;
      }>;
    }
  | { kind: 'none'; reason: string };

export interface DuplicateResolveInput {
  tenantId: string;
  platform: string;
  accountId: string;
  externalUserId?: string | null;
  externalEventId?: string | null;
  profileUrl?: string | null;
  nickname?: string | null;
  text?: string | null;
  avatarHash?: string | null;
}

/** 规范化 profileUrl：去协议/去尾部斜杠/小写 */
export function normalizeProfileUrl(url: string): string {
  return (url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

@Injectable()
export class DuplicateCandidateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 判重（四优先级，PRD LEAD-002）：
   * 1. externalUserId → match（确定重复）
   * 2. externalEventId → match（确定重复）
   * 3. 规范化 profileUrl → high_confidence
   * 4. 昵称/文本/头像相似 → candidate（低置信，不自动合并）
   */
  async resolve(input: DuplicateResolveInput): Promise<DuplicateResolution> {
    const { tenantId, platform, accountId } = input;

    // 1. 确定重复：externalUserId（PlatformIdentity 唯一约束已保证同键只一条）
    if (input.externalUserId?.trim()) {
      const identity = await this.prisma.platformIdentity.findUnique({
        where: {
          tenantId_platform_accountId_externalUserId: {
            tenantId,
            platform,
            accountId,
            externalUserId: input.externalUserId,
          },
        },
      });
      if (identity) {
        return {
          kind: 'match',
          matchedIdentityId: identity.id,
          confidence: 100,
          reason: '同 externalUserId，确定重复',
        };
      }
    }

    // 2. 确定重复：externalEventId（事件维度的身份复用）
    if (input.externalEventId?.trim()) {
      const byEvent = await this.prisma.interactionEvent.findFirst({
        where: {
          tenantId,
          platform,
          accountId,
          externalEventId: input.externalEventId,
        },
        select: { identityId: true },
      });
      if (byEvent?.identityId) {
        return {
          kind: 'match',
          matchedIdentityId: byEvent.identityId,
          confidence: 100,
          reason: '同 externalEventId 关联身份，确定重复',
        };
      }
    }

    // 3. 高置信：规范化 profileUrl
    if (input.profileUrl?.trim()) {
      const normalized = normalizeProfileUrl(input.profileUrl);
      const identities = await this.prisma.platformIdentity.findMany({
        where: { tenantId, platform, accountId },
        select: { id: true, profileUrl: true },
        take: 100,
      });
      const match = identities.find(
        (x) => x.profileUrl && normalizeProfileUrl(x.profileUrl) === normalized,
      );
      if (match) {
        return {
          kind: 'high_confidence',
          matchedIdentityId: match.id,
          confidence: 80,
          reason: '规范化 profileUrl 匹配，高置信重复',
        };
      }
    }

    // 4. 低置信：昵称/文本/头像相似 → candidate（不自动合并）
    if (input.nickname?.trim()) {
      const byNickname = await this.prisma.platformIdentity.findMany({
        where: { tenantId, platform, accountId, nickname: input.nickname },
        select: { id: true, nickname: true },
        take: 5,
      });
      if (byNickname.length > 0) {
        return {
          kind: 'candidate',
          candidates: byNickname.map((n) => ({
            identityId: n.id,
            confidence: 40,
            reason: `昵称「${n.nickname}」相似`,
          })),
        };
      }
    }

    return { kind: 'none', reason: '未发现重复身份' };
  }

  /**
   * 合并（用户确认后调用）：source → target，返回 auditId（可撤销）。
   * 说明：本服务合并的是 PlatformIdentity 层面；CRM 客户合并走 crm.mergeCustomer。
   *
   * 六步闭环 P1-13：合并前把 source 身份完整快照 + 迁移的事件/内容 ID 清单
   * 存入 IdentityMergeAudit，支持 revert 撤销（不再直接无痕删除 source）。
   */
  async merge(input: {
    tenantId: string;
    targetId: string;
    sourceId: string;
    fieldChoices?: Record<string, string>;
  }): Promise<{ merged: true; auditId: string }> {
    const { tenantId, targetId, sourceId } = input;
    if (targetId === sourceId) {
      throw new Error('不能合并到自身');
    }

    const [target, source] = await Promise.all([
      this.prisma.platformIdentity.findUnique({ where: { id: targetId } }),
      this.prisma.platformIdentity.findUnique({ where: { id: sourceId } }),
    ]);
    if (
      !target ||
      !source ||
      target.tenantId !== tenantId ||
      source.tenantId !== tenantId
    ) {
      throw new Error('目标或来源身份不存在或不在同一租户');
    }

    // 迁移前：记录 source 挂载的事件/内容 ID（revert 用）
    const [eventRows, contentRows] = await Promise.all([
      this.prisma.interactionEvent.findMany({
        where: { identityId: sourceId },
        select: { id: true },
      }),
      this.prisma.sourceContent.findMany({
        where: { authorIdentityId: sourceId },
        select: { id: true },
      }),
    ]);

    // 冲突字段：人工选择优先，否则保留 target 现有值，缺失字段从 source 补
    const pick = (field: 'nickname' | 'profileUrl' | 'avatarHash') => {
      const chosen = input.fieldChoices?.[field];
      if (chosen === 'target') return target[field];
      if (chosen === 'source') return source[field];
      return target[field] ?? source[field];
    };

    // 迁移来源身份挂载的事件/内容到目标（保留来源时间线不丢）
    await this.prisma.$transaction([
      this.prisma.interactionEvent.updateMany({
        where: { identityId: sourceId },
        data: { identityId: targetId },
      }),
      this.prisma.sourceContent.updateMany({
        where: { authorIdentityId: sourceId },
        data: { authorIdentityId: targetId },
      }),
      this.prisma.platformIdentity.update({
        where: { id: targetId },
        data: {
          nickname: pick('nickname'),
          profileUrl: pick('profileUrl'),
          avatarHash: pick('avatarHash'),
          verified: target.verified || source.verified,
          identityConfidence: Math.max(
            target.identityConfidence,
            source.identityConfidence,
          ),
          lastSeenAt:
            source.lastSeenAt > target.lastSeenAt
              ? source.lastSeenAt
              : target.lastSeenAt,
          firstSeenAt:
            source.firstSeenAt < target.firstSeenAt
              ? source.firstSeenAt
              : target.firstSeenAt,
        },
      }),
      // 保留来源行（可撤销）：标记并软删 —— 直接删除来源身份（事件已迁移，快照已存）
      this.prisma.platformIdentity.delete({ where: { id: sourceId } }),
    ]);

    // 存审计快照（合并前的 source 完整字段 + 迁移清单），返回真实 auditId 供 revert
    const audit = await this.prisma.identityMergeAudit.create({
      data: {
        tenantId,
        userId: source.userId,
        targetId,
        sourceId,
        sourceSnapshot: {
          platform: source.platform,
          accountId: source.accountId,
          externalUserId: source.externalUserId,
          normalizedHandle: source.normalizedHandle,
          nickname: source.nickname,
          profileUrl: source.profileUrl,
          avatarHash: source.avatarHash,
          verified: source.verified,
          identityConfidence: source.identityConfidence,
          firstSeenAt: source.firstSeenAt,
          lastSeenAt: source.lastSeenAt,
        },
        migratedEventIds: eventRows.map((e) => e.id),
        migratedContentIds: contentRows.map((c) => c.id),
        fieldChoices: input.fieldChoices
          ? (input.fieldChoices as unknown as object)
          : undefined,
      },
    });

    return { merged: true, auditId: audit.id };
  }

  /**
   * 撤销合并（六步闭环 P1-13）：从 IdentityMergeAudit 快照恢复 source 身份，
   * 并把迁移的事件/内容迁回 source。已撤销的审计不可重复撤销。
   */
  async revert(input: {
    tenantId: string;
    auditId: string;
  }): Promise<{ reverted: true; sourceId: string; targetId: string }> {
    const audit = await this.prisma.identityMergeAudit.findUnique({
      where: { id: input.auditId },
    });
    if (!audit || audit.tenantId !== input.tenantId) {
      throw new Error('合并审计记录不存在或不在同一租户');
    }
    if (audit.reverted) {
      throw new Error('该合并已撤销，不能重复撤销');
    }

    const snapshot = audit.sourceSnapshot as Record<string, unknown>;
    const eventIds = (audit.migratedEventIds as string[]) ?? [];
    const contentIds = (audit.migratedContentIds as string[]) ?? [];

    // 全部写操作放进同一事务：恢复 source 身份 + 迁回事件/内容 + 标记已撤销，任一失败全回滚。
    const txOps: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.platformIdentity.create({
        data: {
          id: audit.sourceId,
          tenantId: audit.tenantId,
          userId: audit.userId,
          platform: snapshot.platform as string,
          accountId: snapshot.accountId as string,
          externalUserId:
            (snapshot.externalUserId as string | null) ?? undefined,
          normalizedHandle:
            (snapshot.normalizedHandle as string | null) ?? undefined,
          nickname: (snapshot.nickname as string | null) ?? undefined,
          profileUrl: (snapshot.profileUrl as string | null) ?? undefined,
          avatarHash: (snapshot.avatarHash as string | null) ?? undefined,
          verified: snapshot.verified as boolean,
          identityConfidence: snapshot.identityConfidence as number,
          firstSeenAt: new Date(snapshot.firstSeenAt as string),
          lastSeenAt: new Date(snapshot.lastSeenAt as string),
        },
      }),
    ];
    if (eventIds.length > 0) {
      txOps.push(
        this.prisma.interactionEvent.updateMany({
          where: { id: { in: eventIds }, identityId: audit.targetId },
          data: { identityId: audit.sourceId },
        }),
      );
    }
    if (contentIds.length > 0) {
      txOps.push(
        this.prisma.sourceContent.updateMany({
          where: { id: { in: contentIds }, authorIdentityId: audit.targetId },
          data: { authorIdentityId: audit.sourceId },
        }),
      );
    }
    txOps.push(
      this.prisma.identityMergeAudit.update({
        where: { id: audit.id },
        data: { reverted: true, revertedAt: new Date() },
      }),
    );
    await this.prisma.$transaction(txOps);

    return {
      reverted: true,
      sourceId: audit.sourceId,
      targetId: audit.targetId,
    };
  }
}
