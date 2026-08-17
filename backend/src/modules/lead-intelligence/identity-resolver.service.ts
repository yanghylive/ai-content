// 身份解析（PRD LEAD-001 + 开发文档 §6.2，统一开发计划 §七）
// 把互动事件/来源内容解析到 PlatformIdentity，区分四档：确定/高置信/低置信/未识别。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type IdentityResolution =
  | { kind: 'identified'; identityId: string; confidence: number }
  | { kind: 'high_confidence'; identityId: string; confidence: number }
  | { kind: 'low_confidence'; confidence: number; reason: string }
  | { kind: 'unrecognized'; reason: string };

type ResolveInput = {
  tenantId: string;
  userId: string;
  platform: string;
  accountId: string;
  externalUserId?: string | null;
  profileUrl?: string | null;
  nickname?: string | null;
  avatarHash?: string | null;
  observedAt?: Date;
};

@Injectable()
export class IdentityResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 解析身份：
   * - externalUserId 存在 → identified（verified）
   * - 无 externalUserId 但有 profileUrl → high_confidence
   * - 只有昵称/头像相似 → low_confidence（不自动合并，进 duplicate candidate）
   * - 全缺 → unrecognized（进人工）
   * 解析到身份时 upsert PlatformIdentity（更新 lastSeenAt）。
   */
  async resolve(input: ResolveInput): Promise<IdentityResolution> {
    const { tenantId, userId, platform, accountId } = input;
    const now = input.observedAt ?? new Date();

    // 1. 确定身份：有 externalUserId
    if (input.externalUserId?.trim()) {
      const identity = await this.prisma.platformIdentity.upsert({
        where: {
          tenantId_platform_accountId_externalUserId: {
            tenantId,
            platform,
            accountId,
            externalUserId: input.externalUserId,
          },
        },
        create: {
          tenantId,
          userId,
          platform,
          accountId,
          externalUserId: input.externalUserId,
          profileUrl: input.profileUrl ?? undefined,
          nickname: input.nickname ?? undefined,
          avatarHash: input.avatarHash ?? undefined,
          verified: true,
          identityConfidence: 100,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          lastSeenAt: now,
          profileUrl: input.profileUrl ?? undefined,
          nickname: input.nickname ?? undefined,
        },
      });
      return { kind: 'identified', identityId: identity.id, confidence: 100 };
    }

    // 2. 高置信：无 externalUserId 但有稳定 profileUrl
    if (input.profileUrl?.trim()) {
      const existing = await this.prisma.platformIdentity.findFirst({
        where: { tenantId, platform, accountId, profileUrl: input.profileUrl },
      });
      if (existing) {
        await this.prisma.platformIdentity.update({
          where: { id: existing.id },
          data: { lastSeenAt: now },
        });
        return {
          kind: 'high_confidence',
          identityId: existing.id,
          confidence: 70,
        };
      }
      // 有稳定 profileUrl 但未见过：建一个高置信（未 verified）身份
      const identity = await this.prisma.platformIdentity.create({
        data: {
          tenantId,
          userId,
          platform,
          accountId,
          profileUrl: input.profileUrl,
          nickname: input.nickname ?? undefined,
          avatarHash: input.avatarHash ?? undefined,
          verified: false,
          identityConfidence: 70,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      return {
        kind: 'high_confidence',
        identityId: identity.id,
        confidence: 70,
      };
    }

    // 3. 低置信：只有昵称/头像
    if (input.nickname?.trim() || input.avatarHash?.trim()) {
      return {
        kind: 'low_confidence',
        confidence: 30,
        reason: '仅有昵称/头像，不足以确定身份，进入 duplicate candidate',
      };
    }

    // 4. 未识别
    return {
      kind: 'unrecognized',
      reason: '缺少 externalUserId/profileUrl/昵称，需人工处理',
    };
  }
}
