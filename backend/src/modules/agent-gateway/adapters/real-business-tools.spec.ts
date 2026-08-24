import { Test } from '@nestjs/testing';
import { AgentGatewayModule } from '../agent-gateway.module';
import { AgentGatewayService } from '../agent-gateway.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthService } from '../core/auth';
import { TenantContext, ToolRequest } from '../core/types';

/**
 * RealBusinessTools 集成测试（真实 crm_create → CrmService.createCustomer 落库）。
 * 需本地 pg（DATABASE_URL）+ AGENT_GATEWAY_REAL_BUSINESS=true；无环境自动跳过。
 */
const hasDb = !!process.env.DATABASE_URL;
const test = hasDb ? it : it.skip;

describe('RealBusinessTools（真实 3010 业务工具，crm_create）', () => {
  let svc: AgentGatewayService;
  let moduleRef: Awaited<ReturnType<typeof Test.createTestingModule>>;

  beforeAll(async () => {
    if (!hasDb) return;
    process.env.AGENT_GATEWAY_REAL_BUSINESS = 'true';
    moduleRef = await Test.createTestingModule({
      imports: [AgentGatewayModule, PrismaModule],
    })
      .overrideProvider(AuthService)
      .useValue(new AuthService('test-secret'))
      .compile();
    svc = moduleRef.get(AgentGatewayService);
  });

  afterAll(async () => {
    delete process.env.AGENT_GATEWAY_REAL_BUSINESS;
    await moduleRef?.close();
  });

  function req(sessionId: string, taskId: string, payload: Record<string, unknown>, toolName = 'crm_create'): ToolRequest {
    return {
      requestId: `req_${toolName}_${Date.now().toString(36)}`,
      tenantId: 't1',
      userId: 'u1',
      agentId: 'a1',
      sessionId,
      taskId,
      idempotencyKey: `k_${toolName}_${Date.now().toString(36)}`,
      toolName,
      requiresConfirmation: false,
      payload,
    };
  }

  test('crm_create 走真实 CrmService（无组织账号 → 权限拒绝 failed_terminal，链路真实）', async () => {
    const ctx: TenantContext = { tenantId: 't1', userId: 'u1', agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    const task = svc.gateway.createTask(ctx, session.id, 'crm', {});
    const out = await svc.gateway.executeTool(ctx, req(session.id, task.id, { name: '真实客户A', phone: '13800000001' }));
    expect(out.kind).toBe('awaiting_approval'); // crm_create 高风险
    if (out.kind !== 'awaiting_approval') throw new Error('expect awaiting');
    const res = await svc.gateway.approveTask(ctx, task.id, out.approvalId, {
      toolName: 'crm_create',
      payload: { name: '真实客户A', phone: '13800000001' },
    });
    // 真实业务约束：测试账号不属于可用组织 → CrmService 真实拒绝（FORBIDDEN，确定性失败）
    expect(res.status).toBe('failed_terminal');
    expect(res.error?.message).toContain('可用组织');
  });

  test('lead_discover 走真实 LeadRepository 落库（lead 表真实写入）', async () => {
    const prisma = moduleRef.get(PrismaService);
    const suffix = Date.now().toString(36);
    // Lead 表有 tenantId FK → 需真实 User + Tenant
    const user = await prisma.user.create({
      data: { username: `lead_u_${suffix}`, email: `lead_${suffix}@test.local`, passwordHash: 'x', name: 'lead-test', status: 'active', role: 'operator', commercialExecutionAllowed: false, planMode: 'trial', createdAt: new Date(), updatedAt: new Date() },
    });
    const tenant = await prisma.tenant.create({
      data: { name: `lead-t${suffix}`, slug: `lead-t${suffix}`, status: 'active', ownerUserId: user.id },
    });
    const ctx: TenantContext = { tenantId: tenant.id, userId: user.id, agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    const task = svc.gateway.createTask(ctx, session.id, 'lead', {});
    const out = await svc.gateway.executeTool(
      ctx,
      req(session.id, task.id, { platform: 'xiaohongshu', leads: [{ nickname: `真实线索${suffix}`, sourceUrl: 'https://xhs.example/p/1', externalUserId: `u_${suffix}` }] }, 'lead_discover'),
    );
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.result.status).toBe('succeeded');
      expect(out.result.data?.count).toBe(1);
      expect(out.result.data?.leadIds?.[0]).toBeTruthy(); // 真实 lead id
    }
    // 清理
    await prisma.lead.deleteMany({ where: { userId: user.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test('report_generate 走真实 ReportingService（真实聚合，无数据也返回报告结构）', async () => {
    const ctx: TenantContext = { tenantId: 't1', userId: 'u1', agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    const task = svc.gateway.createTask(ctx, session.id, 'review', {});
    const out = await svc.gateway.executeTool(ctx, req(session.id, task.id, { range: '7d' }, 'report_generate'));
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.result.status).toBe('succeeded');
      expect(out.result.data?.range).toBe('7d');
      expect(out.result.data?.effect).toBeTruthy(); // EffectReport 结构
    }
  });
});
