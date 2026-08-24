import { MemoryOrchestrator } from './core/memory-orchestrator';
import { MockKaypalMemoryAdapter, deriveNamespace } from './adapters/kaypal-memory-mock';
import { TenantContext } from './core/types';

/**
 * 4.4 多工作区标签壳 · 记忆命名空间 workspace 维度隔离。
 * 验证：同用户不同 workspace 的记忆互不串扰；无 workspace（旧调用）向后兼容且不串扰。
 */
function ctx(ws?: string): TenantContext {
  return { tenantId: 't1', userId: 'u1', agentId: 'a1', workspaceId: ws };
}

describe('Memory 命名空间 workspace 维度隔离（4.4）', () => {
  test('同用户不同 workspace：A 写入 B 召回不到，A 可召回', async () => {
    const orch = new MemoryOrchestrator(new MockKaypalMemoryAdapter());
    await orch.capture(ctx('wsA'), 'user_preference', 'A 专属偏好');
    const b = await orch.recall(ctx('wsB'), 'user_preference', '');
    expect(b.items.length).toBe(0);
    const a = await orch.recall(ctx('wsA'), 'user_preference', '');
    expect(a.items.map((i) => i.content)).toContain('A 专属偏好');
  });

  test('无 workspace（旧调用）与有 workspace 互不串扰，且各自可见', async () => {
    const orch = new MemoryOrchestrator(new MockKaypalMemoryAdapter());
    await orch.capture(ctx(undefined), 'user_preference', 'legacy 偏好');
    const w = await orch.recall(ctx('wsX'), 'user_preference', '');
    expect(w.items.length).toBe(0);
    const legacy = await orch.recall(ctx(undefined), 'user_preference', '');
    expect(legacy.items.map((i) => i.content)).toContain('legacy 偏好');
  });

  test('MockKaypalMemoryAdapter 按完整 namespace（含 workspace）隔离存储/导出', async () => {
    const m = new MockKaypalMemoryAdapter();
    const nsA = deriveNamespace(ctx('wsA'), 'user_preference', 'capture');
    const nsB = deriveNamespace(ctx('wsB'), 'user_preference', 'capture');
    await m.add(nsA, 'A 内容');
    expect((await m.export(nsB)).length).toBe(0);
    expect((await m.export(nsA)).map((i) => i.content)).toContain('A 内容');
  });
});
