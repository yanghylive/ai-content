import { Injectable, ForbiddenException } from '@nestjs/common';
import { CrmService } from '../../crm/crm.service';
import { LeadRepository } from '../../leads/lead.repository';
import { ReportingService } from '../../reporting/reporting.service';
import { AuthenticatedUser } from '../../auth/auth.types';
import { BusinessToolRegistry, ToolExecution } from './business-tools';
import { contentGenerate, publishExecute, interactionReplyExecute } from './business-tools';
import { AppErrorError } from '../contracts/error-codes';
import { ErrorCode } from '../core/types';

/**
 * 真实 3010 业务工具（部分接入）——替换 mock 执行器。
 * 已接：crm_create → CrmService.createCustomer（真实 CRM 客户落库）
 *       lead_discover → LeadRepository.upsert（真实线索落库，按 dedupeKey 去重）
 *       report_generate → ReportingService.report（真实复盘报告）
 * 待接（env AGENT_GATEWAY_REAL_BUSINESS=true 后逐步扩，依赖真实 RPA/账号）：
 *   content_generate → 内容服务；publish_execute → PublishingModule（平台账号/RPA）；
 *   interaction_reply_execute → 互动服务（真实发送）
 * 未接工具暂保留 mock 执行器（降级，不阻断）。
 * 启用：AgentGatewayModule imports CrmModule/LeadsModule/ReportingModule；env AGENT_GATEWAY_REAL_BUSINESS=true。
 */
@Injectable()
export class RealBusinessTools {
  constructor(
    private readonly crm: CrmService,
    private readonly leads: LeadRepository,
    private readonly reporting: ReportingService,
  ) {}

  build(): BusinessToolRegistry {
    const r = new BusinessToolRegistry();

    // 真实 CRM 建客户（crm_create，高风险需审批）
    r.register('crm_create', async (ctx, req) => {
      const p = req.payload ?? {};
      const input = {
        displayName: p.name ? String(p.name) : undefined,
        phone: p.phone ? String(p.phone) : undefined,
        sourcePlatform: p.sourcePlatform ? String(p.sourcePlatform) : undefined,
        sourceKeyword: p.sourceKeyword ? String(p.sourceKeyword) : undefined,
        sourceUrl: p.sourceUrl ? String(p.sourceUrl) : undefined,
        metadata: p.metadata ?? undefined,
      };
      let customer: unknown;
      try {
        customer = await this.crm.createCustomer(ctx.userId, input);
      } catch (err) {
        // Nest ForbiddenException（组织权限拒绝）是确定性失败：重试也不会成功，
        // 归 FORBIDDEN（retryable=false → failed_terminal），避免误标为可重试
        if (err instanceof ForbiddenException) {
          throw new AppErrorError('FORBIDDEN' as ErrorCode, err.message, false, {
            details: { reason: err.message, cause: 'crm_create' },
          });
        }
        throw err;
      }
      const row = customer as { id?: string; displayName?: string | null };
      const exec: ToolExecution = {
        data: { contactId: row.id, name: row.displayName ?? p.name ?? '未知', tenantId: ctx.tenantId },
        evidence: [],
        usage: { inputTokens: 60, modelTokens: 120, computeUnits: 1, usageId: `crm_${Date.now().toString(36)}` },
        status: 'succeeded',
      };
      return exec;
    });

    // 真实线索发现落库（lead_discover，中风险）：RPA/爬虫发现结果按 dedupeKey 写入统一 leads 表；
    // 发现动作本身仍需平台 RPA（外部资源），本执行器负责将已知发现结果真实持久化
    r.register('lead_discover', async (ctx, req) => {
      const p = req.payload ?? {};
      const platform = String(p.platform ?? 'xiaohongshu');
      const limit = Math.min(Number(p.limit ?? 18) || 18, 50);
      const leads = (Array.isArray(p.leads) ? p.leads : []).slice(0, limit);
      const created: Array<{ leadId: string | null; nickname: string | null | undefined; created: boolean; error?: string }> = [];
      for (const item of leads as Array<Record<string, unknown>>) {
        const nickname = item.nickname ? String(item.nickname) : undefined;
        const sourceUrl = item.sourceUrl ? String(item.sourceUrl) : undefined;
        const externalUserId = item.externalUserId ? String(item.externalUserId) : undefined;
        try {
          const { lead, created: isNew } = await this.leads.upsert({
            userId: ctx.userId,
            tenantId: ctx.tenantId,
            platform,
            sourceType: 'search',
            sourceUrl: sourceUrl ?? null,
            externalUserId: externalUserId ?? null,
            nickname: nickname ?? null,
            profileUrl: item.profileUrl ? String(item.profileUrl) : null,
            avatarUrl: item.avatarUrl ? String(item.avatarUrl) : null,
            score: item.score != null ? Number(item.score) : undefined,
            matchedKeywords: item.matchedKeywords ? (item.matchedKeywords as never) : undefined,
          });
          created.push({ leadId: lead.id, nickname: lead.nickname, created: isNew });
        } catch (err) {
          // 单条失败不阻断整批（真实约束：lead 表约束/去重异常）
          created.push({ leadId: null, nickname, created: false, error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
        }
      }
      const exec: ToolExecution = {
        data: { count: created.length, leadIds: created.filter((c) => c.leadId).map((c) => c.leadId), platform, tenantId: ctx.tenantId },
        evidence: [],
        usage: { inputTokens: 400, modelTokens: 800, computeUnits: 2, usageId: `lead_${Date.now().toString(36)}` },
        status: 'succeeded',
      };
      return exec;
    });

    // 真实复盘报告（report_generate，低风险）：ReportingService.report 聚合真实发布/互动/CRM 数据
    r.register('report_generate', async (ctx, req) => {
      const range = req.payload?.range === '30d' ? '30d' : '7d';
      const authUser: AuthenticatedUser = {
        id: ctx.userId,
        username: ctx.userId,
        email: '',
        name: '',
        status: 'active',
        lastLoginAt: null,
        role: 'operator',
        commercialExecutionAllowed: false,
        planMode: 'trial',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const effect = await this.reporting.report(authUser, range);
      const exec: ToolExecution = {
        data: { range, reportId: `report_${Date.now().toString(36)}`, effect },
        evidence: [],
        usage: { inputTokens: 500, modelTokens: 900, computeUnits: 3, usageId: `report_${Date.now().toString(36)}` },
        status: 'succeeded',
      };
      return exec;
    });

    // 其余工具暂保留 mock（真实服务待接入，降级不阻断）
    r.register('content_generate', contentGenerate);
    r.register('publish_execute', publishExecute);
    r.register('interaction_reply_execute', interactionReplyExecute);

    return r;
  }
}
