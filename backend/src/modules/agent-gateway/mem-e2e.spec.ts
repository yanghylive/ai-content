import { describe, it, expect } from '@jest/globals';
import { RealKaypalMemoryAdapter } from './adapters/real-kaypal-memory';
import { MemoryNamespace } from './core/types';
import { MemoryOrchestrator } from './core/memory-orchestrator';

/**
 * 真实 Kaypal Memory 端到端（连生产 kaypal.cn，需要 AGENT_GATEWAY_REAL_MEMORY=true + KAYPAL_API_KEY）
 */
const hasRealMemory =
  process.env.AGENT_GATEWAY_REAL_MEMORY === 'true' && !!process.env.KAYPAL_API_KEY && !!process.env.KAYPAL_AUTH_BASE_URL;
const test = hasRealMemory ? it : it.skip;

describe('RealKaypalMemory 生产端到端', () => {
  const ns: MemoryNamespace = { tenantId: 'e2e_tenant', userId: 'e2e_user', agentId: 'e2e_agent', scope: 'user_preference', source: 'e2e', retention: 'long_term' };

  test('写入 → 召回（真实生产链路，不依赖 mock）', async () => {
    const adapter = new RealKaypalMemoryAdapter({
      baseUrl: process.env.KAYPAL_AUTH_BASE_URL!,
      apiKey: process.env.KAYPAL_API_KEY!,
      tokenProvider: async () => {
        const res = await fetch(`${process.env.KAYPAL_AUTH_BASE_URL}/api/desktop-auth/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-kaypal-api-key': process.env.KAYPAL_API_KEY!, accept: 'application/json' },
          body: JSON.stringify({ phone: process.env.KAYPAL_TEST_PHONE, password: process.env.KAYPAL_TEST_PASSWORD, device_id: '3010-memory-e2e', device_name: '3010-memory-e2e', platform: 'desktop' }),
        });
        if (!res.ok) return undefined;
        const d = (await res.json()) as Record<string, unknown>;
        return String(d.access_token ?? d.accessToken ?? '') || undefined;
      },
    });
    const orch = new MemoryOrchestrator(adapter, 2000);
    const content = 'e2e 记忆验证 ' + Date.now().toString(36) + '：用户喜欢简约风格';
    const { memoryEventId } = await orch.capture(ns, 'user_preference', content);
    expect(memoryEventId).toBeTruthy();
    // 等 outbox 异步写入完成
    await new Promise((r) => setTimeout(r, 1500));
    const { items, degraded } = await orch.recall(ns, 'user_preference', '简约风格');
    console.log('recall:', { count: items.length, degraded, first: items[0]?.content });
    expect(degraded).toBe(false); // 真实链路不能降级
    expect(items.length).toBeGreaterThan(0);
  }, 15000);
});
