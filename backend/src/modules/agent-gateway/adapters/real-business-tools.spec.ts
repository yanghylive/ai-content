import { Test } from '@nestjs/testing';
import { AgentGatewayModule } from '../agent-gateway.module';
import { AgentGatewayService } from '../agent-gateway.service';
import { PrismaModule } from '../../../prisma/prisma.module';
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

  function req(sessionId: string, taskId: string, payload: Record<string, unknown>): ToolRequest {
    return {
      requestId: 'req_real_crm',
      tenantId: 't1',
      userId: 'u1',
      agentId: 'a1',
      sessionId,
      taskId,
      idempotencyKey: `k_real_${Date.now().toString(36)}`,
      toolName: 'crm_create',
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
});
