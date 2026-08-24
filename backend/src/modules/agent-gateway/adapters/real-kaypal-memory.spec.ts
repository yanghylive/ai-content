import { RealKaypalMemoryAdapter } from './real-kaypal-memory';
import type { MemoryNamespace } from '../core/types';

/**
 * P3-1：请求级 Bearer token 透传验证。
 * 真实生产路径：每请求 KaypalAuthGuard 验签后写 ctx.kaypalAccessToken，MemoryOrchestrator
 * 透传到 RealKaypalMemoryAdapter，替代过去共享测试账号的 tokenProvider。
 */
describe('RealKaypalMemoryAdapter (P3-1 请求级 token 透传)', () => {
  const ns: MemoryNamespace = {
    tenantId: 't1', userId: 'u1', agentId: 'a1', scope: 'user_preference', source: 'confirmed_user_statement', retention: 'long_term',
  };

  test('accessToken (kda_ 形态) → fetch 走 Bearer 注入；tokenProvider 不被调用', async () => {
    let tokenProviderCalls = 0;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
        status: 200,
      text: async () => JSON.stringify({ items: [] }),
    });
    // @ts-expect-error 全局 fetch mock
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const adapter = new RealKaypalMemoryAdapter({
        baseUrl: 'https://kaypal.cn',
        apiKey: 'should-not-be-used',
        tokenProvider: async () => {
          tokenProviderCalls += 1;
          return 'kda_fallback';
        },
      });
      await adapter.search(ns, 'test', 'kda_user_real_token');
      expect(tokenProviderCalls).toBe(0); // 请求级 token 优先，tokenProvider 不被调用
      const call = fetchSpy.mock.calls[0];
      const headers = (call[1]?.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe('Bearer kda_user_real_token');
      expect(headers['x-kaypal-api-key']).toBeUndefined();
    } finally {
      // @ts-expect-error 测试完恢复
      delete (global as { fetch?: typeof fetch }).fetch;
    }
  });

  test('HMAC 形态测试 token → 回退 tokenProvider（kaypal.cn 不认内部 HMAC）', async () => {
    let tokenProviderCalls = 0;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
        status: 200,
      text: async () => JSON.stringify({ items: [] }),
    });
    // @ts-expect-error 全局 fetch mock
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const adapter = new RealKaypalMemoryAdapter({
        baseUrl: 'https://kaypal.cn',
        apiKey: 'fallback-api-key',
        tokenProvider: async () => {
          tokenProviderCalls += 1;
          return 'kda_real_desktop_token';
        },
      });
      // HMAC 形态（base64.body + base64.sig）= kaypalAuthGuard 内部签发的测试 token
      const hmacToken = 'eyJ0ZW5hbnRJZCI6InQxIn0.Z9xSig';
      await adapter.search(ns, 'test', hmacToken);
      expect(tokenProviderCalls).toBe(1); // 回退 tokenProvider 而非透传
      const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe('Bearer kda_real_desktop_token');
    } finally {
      // @ts-expect-error 测试完恢复
      delete (global as { fetch?: typeof fetch }).fetch;
    }
  });

  test('无 accessToken + 无 tokenProvider → 走 api-key 兜底（向后兼容）', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    });
    // @ts-expect-error 全局 fetch mock
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const adapter = new RealKaypalMemoryAdapter({
        baseUrl: 'https://kaypal.cn',
        apiKey: 'static-api-key',
      });
      await adapter.search(ns, 'test');
      const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
      expect(headers['x-kaypal-api-key']).toBe('static-api-key');
      expect(headers.authorization).toBeUndefined();
    } finally {
      // @ts-expect-error 测试完恢复
      delete (global as { fetch?: typeof fetch }).fetch;
    }
  });
});