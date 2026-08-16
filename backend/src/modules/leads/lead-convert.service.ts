import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 原子转客户（报告 6.3 节 P0）：线索 → CRM 客户必须在单个事务内
 * 「锁定线索 → 按 identity/dedupe 查找或创建客户 → 写来源 TimelineEvent →
 * 更新线索 → 返回统一结果」。杜绝先 createCrmCustomer 再 updateLead
 * 的非原子写法（第二步失败重试会重复创建客户）。
 *
 * 幂等性：以 lead.customerId 为自然幂等锚点——已转客户则直接返回现有客户，
 * 不重复创建客户、不重复写 timeline。
 */

export interface ConvertLeadInput {
  leadId: string;
  /** 幂等键（审计用，可选；天然幂等由 lead.customerId 保证） */
  idempotencyKey?: string;
  scope: { userId: string; tenantId?: string | null };
}

export interface ConvertLeadResult {
  lead: {
    id: string;
    status: string;
    customerId: string | null;
  };
  customer: {
    id: string;
    displayName: string;
    status: string;
  };
  /** true = 本次新建了客户；false = 复用了已有客户或线索已转 */
  created: boolean;
  alreadyConverted: boolean;
}

@Injectable()
export class LeadConvertService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 线索 → 客户 dedupeKey，对齐 crm.service 的 `crm:{子类}:${sha1(...)}` 前缀，
   * 子类用 `lead`（与 `growth-lead` / `manual` 对称），字段取身份强项。
   */
  static customerDedupeKeyOf(lead: {
    nickname: string | null;
    externalUserId: string | null;
    platform: string;
    sourceUrl: string | null;
  }): string {
    const raw = [
      'lead',
      lead.externalUserId ?? '',
      lead.nickname ?? '',
      lead.platform,
      lead.sourceUrl ?? '',
    ].join(':');
    return `crm:lead:${crypto.createHash('sha1').update(raw).digest('hex')}`;
  }

  async convert(input: ConvertLeadInput): Promise<ConvertLeadResult> {
    const { leadId, idempotencyKey, scope } = input;
    const tenantId = scope.tenantId ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1) 锁定线索（scope 校验：只能转自己的线索）
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          userId: scope.userId,
          ...(tenantId ? { tenantId } : {}),
        },
      });
      if (!lead) {
        throw new NotFoundException('线索不存在或无权操作');
      }

      // 2) 幂等：已转客户则直接返回现有客户
      if (lead.customerId) {
        const customer = await tx.crmCustomer.findUnique({
          where: { id: lead.customerId },
        });
        if (!customer) {
          // 数据异常：customerId 悬空，回退重转
          await tx.lead.update({
            where: { id: lead.id },
            data: { customerId: null, status: 'qualified' },
          });
          throw new NotFoundException('线索关联的客户已失效，请重试');
        }
        return {
          lead: { id: lead.id, status: lead.status, customerId: lead.customerId },
          customer: {
            id: customer.id,
            displayName: customer.displayName,
            status: customer.status,
          },
          created: false,
          alreadyConverted: true,
        };
      }

      // 3) 按 identity/dedupe 查找或创建客户
      const dedupeKey = LeadConvertService.customerDedupeKeyOf(lead);
      const dedupeWhere = tenantId
        ? { tenantId_dedupeKey: { tenantId, dedupeKey } }
        : { ownerId_dedupeKey: { ownerId: scope.userId, dedupeKey } };

      const existingCustomer = await tx.crmCustomer.findUnique({
        where: dedupeWhere as Prisma.CrmCustomerWhereUniqueInput,
      });

      const customer = existingCustomer
        ? await tx.crmCustomer.update({
            where: { id: existingCustomer.id },
            data: {
              archivedAt: null,
              sourceText: lead.sourceText ?? existingCustomer.sourceText,
              latestReply: lead.latestReply ?? existingCustomer.latestReply,
              score: Math.max(existingCustomer.score, lead.score ?? 0),
            },
          })
        : await tx.crmCustomer.create({
            data: {
              ownerId: scope.userId,
              actorUserId: scope.userId,
              tenantId,
              displayName:
                lead.nickname ?? lead.externalUserId ?? '未命名客户',
              status: 'new',
              sourcePlatform: lead.platform,
              sourceUrl: lead.sourceUrl,
              sourceText: lead.sourceText,
              latestReply: lead.latestReply,
              externalUserId: lead.externalUserId,
              profileUrl: lead.profileUrl,
              score: lead.score ?? 0,
              dedupeKey,
              tags: [],
            },
          });

      // 4) 写来源 TimelineEvent（含幂等键，审计可追溯）
      await tx.crmTimelineEvent.create({
        data: {
          ownerId: scope.userId,
          tenantId,
          actorUserId: scope.userId,
          customerId: customer.id,
          eventType: 'lead_converted',
          channel: lead.platform,
          content: lead.sourceText ?? `线索转客户：${customer.displayName}`,
          status: customer.status,
          metadata: {
            leadId: lead.id,
            sourceType: lead.sourceType,
            idempotencyKey: idempotencyKey ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      // 5) 更新线索
      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'converted', customerId: customer.id },
      });

      return {
        lead: {
          id: updatedLead.id,
          status: updatedLead.status,
          customerId: updatedLead.customerId,
        },
        customer: {
          id: customer.id,
          displayName: customer.displayName,
          status: customer.status,
        },
        created: !existingCustomer,
        alreadyConverted: false,
      };
    });

    return result;
  }
}
