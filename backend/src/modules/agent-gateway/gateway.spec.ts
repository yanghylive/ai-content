import { describe, it, expect, beforeEach } from '@jest/globals';
import { createAgentGateway } from './core/factory';
import { TenantContext, ToolRequest } from './core/types';

const ctx: TenantContext = { tenantId: 'tenant_1', userId: 'user_1', agentId: 'agent_default' };
const ctx2: TenantContext = { tenantId: 'tenant_2', userId: 'user_2', agentId: 'agent_default' };

function req(g: ReturnType<typeof createAgentGateway>, sessionId: string, taskId: string, toolName: string, idemKey: string, payload: Record<string, unknown> = {}): ToolRequest {
  return {
    requestId: `req_${idemKey}`,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    agentId: ctx.agentId,
    sessionId,
    taskId,
    idempotencyKey: idemKey,
    toolName,
    requiresConfirmation: false,
    payload,
  };
}

describe('AgentGateway 六步闭环', () => {
  let g: ReturnType<typeof createAgentGateway>;
  beforeEach(() => {
    g = createAgentGateway();
  });

  it('内容→获客 无确认工具走通：task 成功、usage 落库、事件齐全', async () => {
    const session = await g.gateway.createSession(ctx);
    const task = g.gateway.createTask(ctx, session.id, 'lead', { platform: 'xiaohongshu' });
    const outcome = await g.gateway.executeTool(ctx, req(g, session.id, task.id, 'lead_discover', 'idem_lead_1', { platform: 'xiaohongshu', limit: 5 }));

    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') {
      expect(outcome.result.status).toBe('succeeded');
      expect(outcome.result.data?.count).toBe(5);
      expect(outcome.result.usage?.usageId).toBeTruthy();
    }
    expect(g.gateway.getTask(task.id)?.status).toBe('succeeded');
    expect(g.gateway.getUsageEvents()).toHaveLength(1);

    const events = g.gateway.snapshotEvents(session.id).map((e) => e.type);
    expect(events).toContain('tool_started');
    expect(events).toContain('tool_progress');
    expect(events).toContain('task_done');
  });

  it('高风险发布走确认流：awaiting_approval → approve → succeeded', async () => {
    const session = await g.gateway.createSession(ctx);
    const task = g.gateway.createTask(ctx, session.id, 'publish', {});
    const outcome = await g.gateway.executeTool(ctx, req(g, session.id, task.id, 'publish_execute', 'idem_pub_1', { platform: 'douyin' }));
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('应为 awaiting_approval');
    expect(g.gateway.getTask(task.id)?.status).toBe('awaiting_confirmation');

    const result = await g.gateway.approveTask(ctx, task.id, outcome.approvalId, {
      toolName: 'publish_execute',
      payload: { platform: 'douyin' },
    });
    expect(result.status).toBe('succeeded');
    expect(g.gateway.getTask(task.id)?.status).toBe('succeeded');
  });

  it('跨租户执行被拒（FORBIDDEN）', async () => {
    const session = await g.gateway.createSession(ctx);
    const task = g.gateway.createTask(ctx, session.id, 'lead', {});
    await expect(
      g.gateway.executeTool(ctx2, req(g, session.id, task.id, 'lead_discover', 'idem_x', { platform: 'x' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('余额门禁：trial 高风险写工具 → INSUFFICIENT_BALANCE + 任务 paused（可恢复）', async () => {
    let gateOk = false;
    const gate = createAgentGateway({
      balanceGate: async () => (gateOk ? { ok: true } : { ok: false, reason: 'trial 模式不开放高风险写工具，请升级商用套餐或充值' }),
    });
    const session = await gate.gateway.createSession(ctx);
    const task = gate.gateway.createTask(ctx, session.id, 'publish', {});
    const outcome = await gate.gateway.executeTool(ctx, req(gate, session.id, task.id, 'publish_execute', 'idem_bal_1', { platform: 'douyin' }));
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') {
      expect(outcome.result.error?.code).toBe('INSUFFICIENT_BALANCE');
      expect(outcome.result.status).toBe('failed_terminal'); // retryable=false（需人工充值后恢复，不自动重试）
    }
    // 任务落 paused 而非 failed（语义：不丢上下文，可恢复）
    expect(gate.gateway.getTask(task.id)?.status).toBe('paused');
    // 事件含 task_paused + paused_insufficient_balance
    const events = gate.gateway.snapshotEvents(session.id);
    const pausedEvt = events.find((e) => e.type === 'task_paused');
    expect(pausedEvt).toBeTruthy();
    expect(pausedEvt?.payload.reason).toBe('paused_insufficient_balance');
    // 未消耗幂等/未建 pending：充值后重新 executeTool（balanceGate 放行）即可继续，且幂等键可复用
    gateOk = true;
    const retry = await gate.gateway.executeTool(ctx, req(gate, session.id, task.id, 'publish_execute', 'idem_bal_1', { platform: 'douyin' }));
    expect(retry.kind).toBe('awaiting_approval'); // 高风险 → 审批流，正常继续
  });

  it('余额门禁放行：gate ok → 正常执行', async () => {
    const gate = createAgentGateway({ balanceGate: async () => ({ ok: true }) });
    const session = await gate.gateway.createSession(ctx);
    const task = gate.gateway.createTask(ctx, session.id, 'lead', {});
    const outcome = await gate.gateway.executeTool(ctx, req(gate, session.id, task.id, 'lead_discover', 'idem_bal_2', { limit: 3 }));
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') expect(outcome.result.status).toBe('succeeded');
  });

  it('重复幂等键（跨任务去重，首个已完成）→ DUPLICATE_REQUEST', async () => {
    const session = await g.gateway.createSession(ctx);
    const task1 = g.gateway.createTask(ctx, session.id, 'lead', {});
    await g.gateway.executeTool(ctx, req(g, session.id, task1.id, 'lead_discover', 'idem_dup', { limit: 3 }));
    const task2 = g.gateway.createTask(ctx, session.id, 'lead', {});
    const second = await g.gateway.executeTool(ctx, req(g, session.id, task2.id, 'lead_discover', 'idem_dup', { limit: 3 }));
    expect(second.kind).toBe('result');
    if (second.kind === 'result') expect(second.result.error?.code).toBe('DUPLICATE_REQUEST');
  });

  it('已终态(succeeded)任务再次执行 → TASK_TERMINAL', async () => {
    const session = await g.gateway.createSession(ctx);
    const task = g.gateway.createTask(ctx, session.id, 'lead', {});
    await g.gateway.executeTool(ctx, req(g, session.id, task.id, 'lead_discover', 'idem_term', { limit: 3 }));
    expect(g.gateway.getTask(task.id)?.status).toBe('succeeded');
    const again = await g.gateway.executeTool(ctx, req(g, session.id, task.id, 'lead_discover', 'idem_term2', { limit: 3 }));
    expect(again.kind).toBe('result');
    if (again.kind === 'result') expect(again.result.error?.code).toBe('TASK_TERMINAL');
  });

  it('同租户不同用户不能操作彼此任务 → FORBIDDEN', async () => {
    const session = await g.gateway.createSession(ctx); // ctx: user_1
    const task = g.gateway.createTask(ctx, session.id, 'lead', {});
    const ctxSameTenantDiffUser: TenantContext = { tenantId: 'tenant_1', userId: 'user_9', agentId: 'agent_default' };
    await expect(
      g.gateway.executeTool(ctxSameTenantDiffUser, req(g, session.id, task.id, 'lead_discover', 'idem_x', { platform: 'x' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('审批预览变化 → PREVIEW_CHANGED', async () => {
    const session = await g.gateway.createSession(ctx);
    const task = g.gateway.createTask(ctx, session.id, 'publish', {});
    const outcome = await g.gateway.executeTool(ctx, req(g, session.id, task.id, 'publish_execute', 'idem_pub_2', { platform: 'douyin' }));
    if (outcome.kind !== 'awaiting_approval') throw new Error('应为 awaiting_approval');
    await expect(
      g.gateway.approveTask(ctx, task.id, outcome.approvalId, { toolName: 'publish_execute', payload: { platform: 'xhs' } }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
  });

  it('planned 任务可取消 → cancelled；已终态再取消 → TASK_TERMINAL', async () => {
    const session = await g.gateway.createSession(ctx);
    const task = g.gateway.createTask(ctx, session.id, 'lead', {});
    const cancelled = g.gateway.cancelTask(ctx, task.id);
    expect(cancelled.status).toBe('cancelled');
    await expect((async () => g.gateway.cancelTask(ctx, task.id))()).rejects.toMatchObject({ code: 'TASK_TERMINAL' });
  });

  it('记忆跨租户隔离 + 远程降级', async () => {
    await g.gateway.memoryAdd(ctx, 'user_preference', '品牌色是紫色');
    const own = await g.gateway.memorySearch(ctx, 'user_preference', '品牌');
    expect(own.items.length).toBe(1);
    const other = await g.gateway.memorySearch(ctx2, 'user_preference', '品牌');
    expect(other.items.length).toBe(0);

    g.memoryRemote.setDegraded(true);
    const degraded = await g.gateway.memorySearch(ctx, 'user_preference', '品牌');
    expect(degraded.degraded).toBe(true);
    expect(degraded.items.length).toBe(1); // 降级仍返回本地结果
  });

  it('未注册工具 → TOOL_NOT_ALLOWED', async () => {
    const session = await g.gateway.createSession(ctx);
    const task = g.gateway.createTask(ctx, session.id, 'x', {});
    const outcome = await g.gateway.executeTool(ctx, req(g, session.id, task.id, 'nonexistent_tool', 'idem_n', {}));
    expect(outcome.kind).toBe('result');
    if (outcome.kind === 'result') expect(outcome.result.error?.code).toBe('TOOL_NOT_ALLOWED');
  });
});
