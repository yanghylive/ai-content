import { Injectable, ForbiddenException } from '@nestjs/common';
import { CrmService } from '../../crm/crm.service';
import { BusinessToolRegistry, ToolExecution } from './business-tools';
import { contentGenerate, publishExecute, reportGenerate, interactionReplyExecute, leadDiscover } from './business-tools';
import { AppErrorError } from '../contracts/error-codes';
import { ErrorCode } from '../core/types';

/**
 * 真实 3010 业务工具（部分接入）——替换 mock 执行器。
 * 已接：crm_create → CrmService.createCustomer（真实 CRM 客户落库）
 * 待接（env AGENT_GATEWAY_REAL_BUSINESS=true 后逐步扩）：
 *   lead_discover → LeadsModule；content_generate → 内容服务；publish_execute → PublishingModule；
 *   report_generate → ReportingModule；interaction_reply_execute → 互动服务
 * 未接工具暂保留 mock 执行器（降级，不阻断）。
 * 启用：AgentGatewayModule imports CrmModule；env AGENT_GATEWAY_REAL_BUSINESS=true。
 */
@Injectable()
export class RealBusinessTools {
  constructor(private readonly crm: CrmService) {}

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

    // 其余工具暂保留 mock（真实服务待接入，降级不阻断）
    r.register('lead_discover', leadDiscover);
    r.register('content_generate', contentGenerate);
    r.register('publish_execute', publishExecute);
    r.register('report_generate', reportGenerate);
    r.register('interaction_reply_execute', interactionReplyExecute);

    return r;
  }
}
