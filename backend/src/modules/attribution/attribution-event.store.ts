// 归因事件存储（开发文档 §11.3 + §23.1，Sprint 4 T4.3）
// 发布服务保存：contentVersionId/publishIntentId/publishRecordId/channelId/platformExternalPostId；
// 互动采集保存：platformExternalPostId 或来源 URL + contentId 关联发布记录。
// 所有对象保存 direct foreign key（AttributionLink，deterministic 层）；昵称/文本/URL 只辅助，不作归因主键。
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type AttributionEndpoint =
  | 'content' // 内容版本
  | 'publish' // 发布记录/任务
  | 'interaction' // 互动事件
  | 'lead'
  | 'customer'
  | 'opportunity';

export const ATTRIBUTION_ENDPOINTS: AttributionEndpoint[] = [
  'content',
  'publish',
  'interaction',
  'lead',
  'customer',
  'opportunity',
];

export interface SaveAttributionLinkInput {
  tenantId: string;
  userId: string;
  fromType: AttributionEndpoint;
  fromId: string;
  toType: AttributionEndpoint;
  toId: string;
  /** deterministic（已确认）/ rule_based（规则匹配）/ inferred（推断） */
  model?: 'deterministic' | 'rule_based' | 'inferred';
  confidence?: 'high' | 'medium' | 'low';
  label?:
    | 'first_touch'
    | 'last_touch'
    | 'qualified_by'
    | 'created_from'
    | 'influenced_by';
  evidence?: Record<string, unknown>;
}

@Injectable()
export class AttributionEventStore {
  constructor(private readonly prisma: PrismaService) {}

  /** 保存归因链（幂等：同四元组只一条，更新证据） */
  async saveLink(input: SaveAttributionLinkInput): Promise<void> {
    const model = input.model ?? 'deterministic';
    await this.prisma.attributionLink.upsert({
      where: {
        tenantId_fromType_fromId_toType_toId_model: {
          tenantId: input.tenantId ?? 'legacy-local-desktop',
          fromType: input.fromType,
          fromId: input.fromId,
          toType: input.toType,
          toId: input.toId,
          model,
        },
      },
      create: {
        tenantId: input.tenantId,
        userId: input.userId,
        fromType: input.fromType,
        fromId: input.fromId,
        toType: input.toType,
        toId: input.toId,
        model,
        confidence: input.confidence ?? 'high',
        label: input.label,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- 防止 --fix 删除断言导致类型错误
        evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        confidence: input.confidence ?? undefined,
        label: input.label ?? undefined,
        evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 发布侧保存完整主键链（T4.3#1）：
   * contentVersionId → publishRecordId → （后续互动/线索环节由采集端补链）
   */
  async savePublishChain(input: {
    tenantId: string;
    userId: string;
    contentVersionId: string;
    publishRecordId: string;
    channelId?: string | null;
    platformExternalPostId?: string | null;
  }): Promise<void> {
    await this.saveLink({
      tenantId: input.tenantId,
      userId: input.userId,
      fromType: 'content',
      fromId: input.contentVersionId,
      toType: 'publish',
      toId: input.publishRecordId,
      label: 'created_from',
      evidence: {
        channelId: input.channelId ?? null,
        platformExternalPostId: input.platformExternalPostId ?? null,
      },
    });
  }

  /**
   * 互动侧保存链（T4.3#2）：platformExternalPostId 或来源 URL 关联到发布记录/内容。
   * 主键优先：publishRecordId / contentId 直连；仅 URL 时 fallback rule_based（推断层）。
   */
  async saveInteractionChain(input: {
    tenantId: string;
    userId: string;
    interactionEventId: string;
    publishRecordId?: string | null;
    contentId?: string | null;
    platformExternalPostId?: string | null;
    sourceUrl?: string | null;
  }): Promise<void> {
    // 主键直连（deterministic）：事件 → 发布记录
    if (input.publishRecordId) {
      await this.saveLink({
        tenantId: input.tenantId,
        userId: input.userId,
        fromType: 'interaction',
        fromId: input.interactionEventId,
        toType: 'publish',
        toId: input.publishRecordId,
        label: 'created_from',
        evidence: {
          platformExternalPostId: input.platformExternalPostId ?? null,
        },
      });
    }
    // 主键直连：事件 → 内容
    if (input.contentId) {
      await this.saveLink({
        tenantId: input.tenantId,
        userId: input.userId,
        fromType: 'interaction',
        fromId: input.interactionEventId,
        toType: 'content',
        toId: input.contentId,
        label: 'created_from',
        evidence: {
          platformExternalPostId: input.platformExternalPostId ?? null,
        },
      });
    }
    // 仅 URL：rule_based（规则匹配，不伪造精确归因）
    if (!input.publishRecordId && !input.contentId && input.sourceUrl) {
      const pub = await this.prisma.publishRecord.findFirst({
        where: { userId: input.userId, publishUrl: input.sourceUrl },
        select: { id: true },
      });
      if (pub) {
        await this.saveLink({
          tenantId: input.tenantId,
          userId: input.userId,
          fromType: 'interaction',
          fromId: input.interactionEventId,
          toType: 'publish',
          toId: pub.id,
          model: 'rule_based',
          confidence: 'medium',
          label: 'influenced_by',
          evidence: {
            sourceUrl: input.sourceUrl,
            note: '仅 URL 弱关联，规则匹配',
          },
        });
      }
    }
  }

  /** 线索 → 客户/商机（结果层补链，convertLeadAtomic 后调用） */
  async saveLeadResultChain(input: {
    tenantId: string;
    userId: string;
    leadId: string;
    customerId: string;
    opportunityId?: string | null;
  }): Promise<void> {
    await this.saveLink({
      tenantId: input.tenantId,
      userId: input.userId,
      fromType: 'lead',
      fromId: input.leadId,
      toType: 'customer',
      toId: input.customerId,
      label: 'qualified_by',
    });
    if (input.opportunityId) {
      await this.saveLink({
        tenantId: input.tenantId,
        userId: input.userId,
        fromType: 'customer',
        fromId: input.customerId,
        toType: 'opportunity',
        toId: input.opportunityId,
        label: 'created_from',
      });
    }
  }
}
