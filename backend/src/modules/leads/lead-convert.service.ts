import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IdentityResolverService } from '../lead-intelligence/identity-resolver.service';

/**
 * 原子转 CRM（报告 6.3 P0 + 开发文档 §11.1，Sprint 4 T4.1）：
 * 线索 → CRM 客户必须在单个事务内完成 10 步：
 *   scope 校验 → 解析身份 → 找/建 Contact → 找/建 Company → 建 Opportunity
 *   → 建 Task/Note → 写 TimelineEvent → 更新 Lead → 写 outbox → 提交
 * 任何一步失败全回滚；幂等（lead.customerId 自然锚点，同 idempotencyKey 返回同一结果）；
 * 保留原始 Lead 不删来源和历史。
 */

export interface ConvertLeadCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  website?: string;
  city?: string;
}

export interface ConvertLeadOpportunityInput {
  stage?: string; // new/qualified/discovery/proposal/negotiation/won/lost/nurture
  expectedAmount?: number; // 元（转 cents 存储）
  closeDate?: Date;
  nextStep?: string;
  source?: string;
}

export interface ConvertLeadTaskInput {
  title: string;
  description?: string;
  priority?: string;
  dueAt?: Date;
}

export interface ConvertLeadNoteInput {
  body: string;
}

export interface ConvertLeadInput {
  leadId: string;
  /** 幂等键（审计用，可选；天然幂等由 lead.customerId 保证） */
  idempotencyKey?: string;
  scope: { userId: string; tenantId?: string | null };
  // —— T4.1 扩展（可选，一步建商机/任务/备注）——
  company?: ConvertLeadCompanyInput;
  opportunity?: ConvertLeadOpportunityInput;
  /** 可选：自定义转客户待办；缺省时默认建「跟进新客户」待办，传 null 则不建 */
  task?: ConvertLeadTaskInput | null;
  note?: ConvertLeadNoteInput;
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
  /** 解析/关联到的平台身份（无则 null） */
  identityId?: string | null;
  companyId?: string;
  opportunityId?: string;
  taskId?: string;
  noteId?: string;
  timelineEventIds: string[];
  /** true = 本次新建了客户；false = 复用了已有客户或线索已转 */
  created: boolean;
  alreadyConverted: boolean;
}

@Injectable()
export class LeadConvertService {
  private readonly logger = new Logger(LeadConvertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identityResolver?: IdentityResolverService,
  ) {}

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

      // 2) 幂等：已转客户则直接返回现有客户（同结果，不重复建）
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
          lead: {
            id: lead.id,
            status: lead.status,
            customerId: lead.customerId,
          },
          customer: {
            id: customer.id,
            displayName: customer.displayName,
            status: customer.status,
          },
          timelineEventIds: [],
          created: false,
          alreadyConverted: true,
        };
      }

      // 3) 解析/关联平台身份（T4.1#2；event 已有 identityId 直接复用，无 resolver 时也能工作）
      let identityId: string | null = null;
      if (lead.sourceInteractionEventId) {
        const ev = await tx.interactionEvent.findUnique({
          where: { id: lead.sourceInteractionEventId },
          select: { identityId: true, platform: true, accountId: true },
        });
        if (ev?.identityId) {
          identityId = ev.identityId;
        } else if (ev && this.identityResolver) {
          const resolved = await this.identityResolver.resolve({
            tenantId: tenantId ?? 'legacy-local-desktop',
            userId: scope.userId,
            platform: ev.platform,
            accountId: ev.accountId ?? 'unknown',
            externalUserId: lead.externalUserId,
            profileUrl: lead.profileUrl,
            nickname: lead.nickname,
          });
          if (
            resolved.kind === 'identified' ||
            resolved.kind === 'high_confidence'
          ) {
            identityId = resolved.identityId;
          }
        }
      }

      // 4) 按 identity/dedupe 查找或创建客户（Contact）
      const dedupeKey = LeadConvertService.customerDedupeKeyOf(lead);
      const dedupeWhere = tenantId
        ? { tenantId_dedupeKey: { tenantId, dedupeKey } }
        : { ownerId_dedupeKey: { ownerId: scope.userId, dedupeKey } };

      const existingCustomer = await tx.crmCustomer.findUnique({
        where: dedupeWhere,
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
              displayName: lead.nickname ?? lead.externalUserId ?? '未命名客户',
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

      // 5) 找/建 Company（T4.1#4；按 name dedupe）
      let companyId: string | undefined;
      if (input.company?.name?.trim()) {
        const existingCompany = await tx.crmCompany.findFirst({
          where: {
            ownerId: scope.userId,
            ...(tenantId ? { tenantId } : {}),
            name: input.company.name,
            archivedAt: null,
          },
        });
        const company = existingCompany
          ? existingCompany
          : await tx.crmCompany.create({
              data: {
                ownerId: scope.userId,
                actorUserId: scope.userId,
                tenantId,
                name: input.company.name,
                domain: input.company.domain,
                industry: input.company.industry,
                website: input.company.website,
                city: input.company.city,
                ownerUserId: scope.userId,
                tags: [],
              },
            });
        companyId = company.id;
      }

      // 6) 建 Opportunity（T4.1#5；可选）
      let opportunityId: string | undefined;
      if (input.opportunity) {
        const opp = await tx.crmOpportunity.create({
          data: {
            ownerId: scope.userId,
            actorUserId: scope.userId,
            tenantId,
            name: `${customer.displayName} 商机`,
            stage: input.opportunity.stage ?? 'qualified',
            amountCents: Math.round(
              (input.opportunity.expectedAmount ?? 0) * 100,
            ),
            currency: 'CNY',
            probability: 20,
            companyId,
            primaryCustomerId: customer.id,
            closeDate: input.opportunity.closeDate,
            nextStep: input.opportunity.nextStep,
            source: input.opportunity.source ?? 'lead_convert',
          },
        });
        opportunityId = opp.id;
      }

      // 7) 建 Task（默认「跟进新客户」待办，让商户在 CRM 待办里看到新客户；
      //    调用方传 input.task 用其内容，传 null 则不建）
      let taskId: string | undefined;
      if (input.task !== null) {
        const followUpTitle = customer.displayName
          ? `跟进新客户：${customer.displayName}`
          : '跟进新客户';
        const task = await tx.crmTask.create({
          data: {
            ownerId: scope.userId,
            actorUserId: scope.userId,
            tenantId,
            title: input.task?.title?.trim() || followUpTitle,
            description:
              input.task?.description ?? '线索已转为客户，请及时跟进。',
            priority: input.task?.priority ?? 'normal',
            dueAt: input.task?.dueAt,
            customerId: customer.id,
            companyId,
            opportunityId,
          },
        });
        taskId = task.id;
      }

      let noteId: string | undefined;
      if (input.note?.body?.trim()) {
        const note = await tx.crmNote.create({
          data: {
            ownerId: scope.userId,
            actorUserId: scope.userId,
            tenantId,
            body: input.note.body,
            createdBy: scope.userId,
            customerId: customer.id,
            companyId,
            opportunityId,
          },
        });
        noteId = note.id;
      }

      // 8) 写来源 TimelineEvent（含幂等键 + 归因主键链，审计可追溯）
      const timelineEvent = await tx.crmTimelineEvent.create({
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
            // 归因主键链（开发文档 §11.3）：内容→发布→互动→线索→客户
            sourceArticleId: lead.sourceArticleId,
            sourcePublishRecordId: lead.sourcePublishRecordId,
            sourceInteractionEventId: lead.sourceInteractionEventId,
            sourceUrl: lead.sourceUrl,
            identityId,
            companyId,
            opportunityId,
            taskId,
            idempotencyKey: idempotencyKey ?? null,
          },
        },
      });

      // 9) 更新线索（customerId 关联；status 走状态机合法流转）
      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: 'converted',
          customerId: customer.id,
        },
      });

      // 10) 写 outbox 事件移到事务外（见 convert 尾部）：事务内写失败会随事务回滚/吞掉，
      // 导致「CRM 已转换但事件缺失」；移到提交后写，失败可告警重试。

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
        identityId,
        companyId,
        opportunityId,
        taskId,
        noteId,
        timelineEventIds: [timelineEvent.id],
        created: !existingCustomer,
        alreadyConverted: false,
      };
    });

    // 事务提交后写 outbox 事件（失败不阻断 CRM 转换，但告警可重试，避免「CRM 已转换但事件缺失」）
    try {
      const outboxKey = idempotencyKey ?? `convert-crm:${leadId}`;
      await this.prisma.domainEventOutbox.create({
        data: {
          eventId: crypto.createHash('sha1').update(outboxKey).digest('hex'),
          schemaVersion: 1,
          tenantId: tenantId ?? 'legacy-local-desktop',
          userId: scope.userId,
          aggregateType: 'lead',
          aggregateId: leadId,
          type: 'lead.action.executed',
          idempotencyKey: outboxKey,
          occurredAt: new Date(),
          payload: {
            actionType: 'convert_crm',
            leadId,
            customerId: result.customer.id,
            companyId: result.companyId,
            opportunityId: result.opportunityId,
            taskId: result.taskId,
            noteId: result.noteId,
            identityId: result.identityId,
          },
          status: 'published',
        },
      });
    } catch (error) {
      this.logger.warn(
        `domain outbox 落库失败（lead=${leadId}，CRM 已转换）：${(error as Error).message}`,
      );
    }

    return result;
  }
}
