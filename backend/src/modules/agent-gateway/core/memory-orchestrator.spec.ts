import { MemoryOrchestrator } from './memory-orchestrator';
import { MockKaypalMemoryAdapter } from '../adapters/kaypal-memory-mock';
import type { TenantContext } from './types';

/**
 * P3-2：Memory namespace 统一 + 跨用户隔离。
 * 所有记忆操作（search/recall/export/delete）必须按 ctx 派生 namespace，
 * 禁止按客户端/模型传入值召回或删除他人数据。
 */
describe('MemoryOrchestrator (P3-2 namespace 统一 + 跨用户隔离)', () => {
  const baseCtx: TenantContext = { tenantId: 'tenant-A', userId: 'user-A', agentId: 'agent-1' };
  const otherUserCtx: TenantContext = { tenantId: 'tenant-A', userId: 'user-B', agentId: 'agent-1' };
  const otherTenantCtx: TenantContext = { tenantId: 'tenant-B', userId: 'user-A', agentId: 'agent-1' };
  const otherAgentCtx: TenantContext = { tenantId: 'tenant-A', userId: 'user-A', agentId: 'agent-2' };

  function make(): MemoryOrchestrator {
    return new MemoryOrchestrator(new MockKaypalMemoryAdapter());
  }

  test('recall：用户 A 写一条 → A 能召回（count=1），用户 B 不能召回（count=0）', async () => {
    const orch = make();
    await orch.capture(baseCtx, 'user_preference', '我喜欢简约风格', 'confirmed_user_statement');
    // 等 outbox flush 完成（flush 是 fire-and-forget，但 mock 同步写入，本地立即可见）
    const aRecall = await orch.recall(baseCtx, 'user_preference', '简约');
    const bRecall = await orch.recall(otherUserCtx, 'user_preference', '简约');
    expect(aRecall.items.length).toBe(1);
    expect(bRecall.items.length).toBe(0); // 跨用户隔离
  });

  test('export：用户 A 写一条 → A 导出 1 条，用户 B 导出 0 条（namespace 严格匹配）', async () => {
    const orch = make();
    await orch.capture(baseCtx, 'user_preference', '我喜欢深色主题', 'confirmed_user_statement');
    const aExport = await orch.export(baseCtx, 'user_preference');
    const bExport = await orch.export(otherUserCtx, 'user_preference');
    expect(aExport.length).toBe(1);
    expect(bExport.length).toBe(0);
  });

  test('delete：用户 B 不能删除用户 A 的记忆（A 的记忆仍存在）', async () => {
    const orch = make();
    const { outboxId } = await orch.capture(baseCtx, 'user_preference', '装修预算 30 万', 'confirmed_user_statement');
    const recallBefore = await orch.recall(baseCtx, 'user_preference', '装修');
    const itemId = recallBefore.items[0].id;
    expect(itemId).toBeTruthy();
    expect(outboxId).toBeTruthy();

    // B 尝试删除 A 的 item → 必须 deleted=false
    const bResult = await orch.delete(otherUserCtx, itemId!, 'user_preference');
    expect(bResult.deleted).toBe(false);

    // A 的记忆仍存在
    const aRecallAfter = await orch.recall(baseCtx, 'user_preference', '装修');
    expect(aRecallAfter.items.length).toBe(1);

    // A 自己删 → deleted=true
    const aResult = await orch.delete(baseCtx, itemId!, 'user_preference');
    expect(aResult.deleted).toBe(true);
  });

  test('跨租户隔离：tenant-B 的 ctx 召回/导出 tenant-A 写入的记忆 = 0 条', async () => {
    const orch = make();
    await orch.capture(baseCtx, 'user_preference', '租户 A 的偏好', 'confirmed_user_statement');
    const otherTenantRecall = await orch.recall(otherTenantCtx, 'user_preference', '偏好');
    const otherTenantExport = await orch.export(otherTenantCtx, 'user_preference');
    expect(otherTenantRecall.items.length).toBe(0);
    expect(otherTenantExport.length).toBe(0);
  });

  test('跨 Agent 隔离：agent-2 不能召回 agent-1 写入的记忆（namespace.agentId 维度）', async () => {
    const orch = make();
    await orch.capture(baseCtx, 'user_preference', 'agent-1 的偏好', 'confirmed_user_statement');
    const otherAgentRecall = await orch.recall(otherAgentCtx, 'user_preference', '偏好');
    expect(otherAgentRecall.items.length).toBe(0);
  });

  test('scope 隔离：同一用户/agent 不同 scope 的记忆互不可见（recall/export 按 scope 分桶）', async () => {
    const orch = make();
    await orch.capture(baseCtx, 'user_preference', '装修风格', 'confirmed_user_statement');
    await orch.capture(baseCtx, 'crm_lead', '高意向客户', 'confirmed_user_statement');
    const prefRecall = await orch.recall(baseCtx, 'user_preference', '风格');
    const crmRecall = await orch.recall(baseCtx, 'crm_lead', '客户');
    expect(prefRecall.items.length).toBe(1);
    expect(crmRecall.items.length).toBe(1);
    expect(prefRecall.items[0].scope).toBe('user_preference');
    expect(crmRecall.items[0].scope).toBe('crm_lead');
  });
});